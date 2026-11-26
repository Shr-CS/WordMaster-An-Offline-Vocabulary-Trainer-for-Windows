#!/usr/bin/env python3
"""Rebuild the reviewed lexicon and seven catalogs from pinned, offline snapshots."""
import csv, gzip, hashlib, json, re
from collections import defaultdict, Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'src/data'
SRC = DATA / 'sources'
OUT = ROOT / 'docs/vocabulary-audit.json'
POS = {'n':'n.','pl':'n.','v':'v.','vt':'v.','vi':'v.','a':'adj.','adj':'adj.',
       'adv':'adv.','prep':'prep.','pron':'pron.','conj':'conj.','num':'num.',
       'art':'art.','interj':'int.','int':'int.','aux':'aux.','abbr':'abbr.','det':'det.'}
CEFR_POS={'noun':'n.','verb':'v.','adjective':'adj.','adverb':'adv.','preposition':'prep.',
          'pronoun':'pron.','conjunction':'conj.','determiner':'det.','modal auxiliary':'aux.',
          'interjection':'int.','number':'num.','infinitive-to':'prep.'}
TAGS={'junior':'zk','senior':'gk','cet4':'cet4','cet6':'cet6','ielts':'ielts','toefl':'toefl'}
NAMES={'primary':'小学','junior':'初中','senior':'高中','cet4':'四级','cet6':'六级','ielts':'雅思','toefl':'托福'}
LEVELS=list(NAMES)

def read_json(file): return json.loads(file.read_text(encoding='utf8'))
def write_json(file,value): file.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def unpack(file): return json.loads(gzip.decompress(file.read_bytes()))
def decode(text): return text.replace('\\r','').replace('\\n','\n').replace('\\\\','\\').strip()
def normalize(text): return re.sub(r'[\s，,。.;；、（）()]','',text.lower())

def parse_senses(row):
    senses=[]
    for line in decode(row['translation']).splitlines():
        line=line.strip()
        match=re.match(r'^(n|pl|vt|vi|v|a|adj|adv|prep|pron|conj|num|art|interj|int|aux|abbr|det)\.(.*)$',line)
        if not match: continue
        pos=POS[match[1]]
        # Specialist-only lines are not used as the primary learning gloss.
        zh=re.sub(r'\[[^\]]*\]','',match[2])
        zh=re.sub(r'（[^）]*(?:复数|过去|分词|第三人称)[^）]*）|\([^)]*(?:复数|过去|分词|第三人称)[^)]*\)','',zh)
        zh=re.sub(r'\s+', '', zh.replace(',', '，').replace(';','；')).replace('象，','像，').strip(' ，；')
        if not re.search('[\u4e00-\u9fff]',zh) or not zh:continue
        if any(s['pos']==pos and s['zh']==zh for s in senses):continue
        senses.append({'pos':pos,'zh':zh})
    return senses

def modern_ipa(text):
    # ECDICT uses an older phonetic alphabet. Keep its provenance separate from US IPA.
    return '/'+text.strip('/[] ').replace('ә','ə').replace(':','ː').replace("'",'ˈ').replace('ɡ','g')+'/'

manifest=read_json(SRC/'manifest.json')
for source in manifest['sources']:
    actual=hashlib.sha256((SRC/source['snapshot']).read_bytes()).hexdigest()
    if actual != source['snapshotSha256']:raise ValueError('Snapshot checksum mismatch: '+source['id'])
raw=unpack(SRC/'ecdict.json.gz')
lookup={r['word'].lower():r for r in raw}
ipa=unpack(SRC/'ipa-us.json.gz')
corrections=read_json(ROOT/'tools/vocabulary/corrections.json')
excluded=set(corrections['exclude'])
cefr=defaultdict(list); variants=defaultdict(set); primary=set()
for row in csv.DictReader((SRC/'cefrj.csv').open(encoding='utf8')):
    words=[w.strip() for w in row['headword'].split('/')]
    for w in words:
        key=w.lower()
        if not re.fullmatch(r"[A-Za-z]+(?:[ .'-][A-Za-z]+)*\.?",w):continue
        cefr[key].append({'level':row['CEFR'],'pos':CEFR_POS.get(row['pos'], '')})
        variants[key].update(v.lower() for v in words if v.lower()!=key)
        if row['CEFR']=='A1':primary.add(key)

def base_of(key):
    row=lookup.get(key)
    if not row:return key
    exchange=dict(x.split(':',1) for x in row['exchange'].split('/') if ':' in x)
    base=exchange.get('0','').lower()
    if base and base!=key and base in lookup:
        text=decode(row['translation'])
        # Adjectives such as interesting/experienced remain words in their own right.
        if re.search(r'的(?:复数|过去式|过去分词|第三人称|现在分词)',text) and not re.search(r'(?:^|\n)(?:a|adj)\.',text):return base
    return key

membership={level:set() for level in LEVELS}
for key in primary:
    if key in lookup:membership['primary'].add(base_of(key))
for row in raw:
    key=base_of(row['word'].lower())
    for level,tag in TAGS.items():
        if tag in row['tag'].split():membership[level].add(key)
# CET-6 is an extended bank: include the CET-4 foundation rather than dropping familiar words.
membership['cet6'].update(membership['cet4'])
# Higher banks retain their foundation; ECDICT tags omit many basic words.
membership['junior'].update(membership['primary'])
membership['senior'].update(membership['junior'])
membership['cet4'].update(membership['senior'])
membership['cet6'].update(membership['cet4'])
for level in ['ielts','toefl']:membership[level].update(membership['junior'])
needed=set().union(*membership.values())
lexicon={}; rejected={}; pronunciation=Counter()
for key in sorted(needed):
    row=lookup.get(key)
    if key in excluded:rejected[key]='reviewed exclusion';continue
    if not row:rejected[key]='not in pinned dictionary';continue
    if re.search(r'\[人名\]|\[地名\]',decode(row['translation'])) and not cefr.get(key):
        rejected[key]='proper name outside basic profile';continue
    patch=corrections['entries'].get(key,{})
    senses=patch.get('senses') or parse_senses(row)
    if not senses and patch.get('zh'):senses=[{'pos':patch['pos'],'zh':patch['zh']}]
    if not senses:rejected[key]='no reliable part-of-speech sense';continue
    preferred=next((x['pos'] for x in sorted(cefr[key],key=lambda x:x['level']) if x['pos']),None)
    chosen=next((s for s in senses if s['pos']==patch.get('pos',preferred)),senses[0])
    if patch.get('zh'):
        chosen={'pos':patch.get('pos',chosen['pos']),'zh':patch['zh']}
        if chosen not in senses:senses.insert(0,chosen)
    # A concise quiz gloss, with complete separate senses retained for reading.
    pieces=[x.strip() for x in re.split('[，；]',chosen['zh']) if x.strip()]
    gloss='，'.join(pieces[:2])
    if len(gloss)>26:gloss=pieces[0]
    if len(gloss)>40:rejected[key]='gloss needs editorial review';continue
    readings=re.findall(r'/[^/]+/',ipa.get(key,''))
    readings=[p.replace('ɹ','r').replace('ɫ','l') for p in readings]
    if patch.get('ipa'):readings=[patch['ipa']]
    dialect='美式'
    if not readings and row['phonetic']:
        readings=[modern_ipa(row['phonetic'])];dialect='英式'
    if not readings:rejected[key]='no verified pronunciation';continue
    en=patch.get('en',row['word'])
    if en=='AM':en='am'
    word={'en':en,'zh':gloss,'pos':chosen['pos'],'ipa':readings[0],
          'senses':senses,'pronunciations':list(dict.fromkeys(readings)),
          'accent':dialect,'source':'ecdict+editorial' if patch else 'ecdict','ipaSource':'editorial' if patch.get('ipa') else ('ipa-us' if dialect=='美式' else 'ecdict')}
    if cefr.get(key):word['cefr']=min(x['level'] for x in cefr[key])
    exchange=dict(x.split(':',1) for x in row['exchange'].split('/') if ':' in x)
    forms={name:exchange[k] for k,name in [('s','复数'),('3','第三人称单数'),('p','过去式'),('d','过去分词'),('i','现在分词'),('r','比较级'),('t','最高级')] if k in exchange}
    if forms:word['forms']=forms
    ranks=[int(row[x]) for x in ['bnc','frq'] if row[x].isdigit() and int(row[x])>0]
    word['rank']=min(ranks,default=999999)
    lexicon[key]=word;pronunciation[word['ipaSource']]+=1
# Separate the month name from the modal verb instead of merging unrelated senses.
if 'may' in lexicon:
    lexicon['May']={'en':'May','zh':'五月','pos':'n.','ipa':'/meɪ/','senses':[{'pos':'n.','zh':'五月'}],
      'pronunciations':['/meɪ/'],'accent':'美式','source':'editorial','ipaSource':'editorial','cefr':'A1','rank':984}
    for level in LEVELS:
        if 'may' in membership[level]:membership[level].add('May')
# Named spelling variants are accepted in spelling practice only when the word class agrees.
for key,w in lexicon.items():
    alt=[lexicon[k]['en'] for k in sorted(variants[key]) if k in lexicon and lexicon[k]['pos']==w['pos']]
    if alt:w['variants']=alt

# Choose short complete corpus sentences whose Chinese translation contains a relevant sense.
# The original text and each contributor's attribution are retained unchanged.
examples={}; tokens=defaultdict(list)
for line in gzip.decompress((SRC/'examples.tsv.gz').read_bytes()).decode('utf-8-sig').splitlines():
    parts=line.split('\t')
    if len(parts)!=3:continue
    en,zh,credit=parts
    if not 4<=len(re.findall(r"[A-Za-z']+",en))<=16 or len(en)>120:continue
    if not en.endswith(('.', '?', '!')) or 'http' in en or re.search(r'\b(?:kill|suicide|rape|sex|fuck|shit|damn|murder|naked)\w*\b',en,re.I):continue
    # Prefer simplified Chinese pairs; traditional-only pairs are left unmodified and unused.
    if re.search('[這個們來說會時學書車國為與還對裡開關沒讓點過從將愛寫讀聽買錢覺見話難歲嗎]',zh):continue
    sid=re.findall(r'#(\d+)',credit)
    if len(sid)!=2:continue
    obj={'en':en,'zh':zh,'attribution':credit,'url':'https://tatoeba.org/en/sentences/show/'+sid[0]}
    identifier='tatoeba:'+':'.join(sid)
    for token in set(re.findall(r"[a-z]+(?:'[a-z]+)?",en.lower())):
        if token in lexicon:tokens[token].append((identifier,obj))
for key,w in lexicon.items():
    senses=[{'zh':w['zh']}]
    terms=[re.sub(r'[（(].*?[）)]','',t).strip() for s in senses for t in re.split('[，；]',s['zh'])]
    terms=[t for t in terms if 1<=len(t)<=8 and t not in ['一','二','三','是','有','这','那','个','在','给','向','的']]
    candidates=[]
    for identifier,obj in tokens.get(key.lower(),[]):
        if not any(t in obj['zh'] for t in terms):continue
        score=abs(len(obj['en'].split())-8)+(6 if 'Tom' in obj['en'] else 0)
        candidates.append((score,identifier,obj))
    if candidates:
        _,identifier,obj=min(candidates,key=lambda x:(x[0],x[1]))
        examples[identifier]=obj;w['exampleId']=identifier

catalog={'version':manifest['revision'],'levels':{}}
for level in LEVELS:
    keys=[k for k in membership[level] if k in lexicon]
    keys.sort(key=lambda k:(lexicon[k].get('cefr','Z'),lexicon[k]['rank'],k.lower()))
    catalog['levels'][level]={'name':NAMES[level],'basis':'CEFR-J A1' if level=='primary' else ('ECDICT '+TAGS[level]+' + foundation'),'words':keys}
lexicon={k:w for k,w in lexicon.items() if any(k in row['words'] for row in catalog['levels'].values())}
write_json(DATA/'lexicon.json',lexicon)
write_json(DATA/'catalog.json',catalog)
write_json(DATA/'examples.json',examples)
audit={'version':catalog['version'],'uniqueWords':len(lexicon),'levelEntries':sum(len(x['words'])for x in catalog['levels'].values()),
       'levels':{k:{'count':len(v['words']),'withExample':sum('exampleId'in lexicon[w]for w in v['words']),'basis':v['basis']}for k,v in catalog['levels'].items()},
       'uniqueExamples':len(examples),'pronunciationSources':dict(Counter(w['ipaSource'] for w in lexicon.values())),'excluded':rejected,
       'notes':['Primary is a CEFR-J A1 reference bank, not a Chinese primary-school syllabus.',
                'Exam labels are ECDICT tags, not a claim of exhaustive official exam coverage.',
                'Corpus examples are conservatively matched and are not present for every entry.']}
write_json(OUT,audit)
print(json.dumps({k:v for k,v in audit.items() if k not in ['excluded','notes']},ensure_ascii=False,indent=2))
print('Excluded',len(rejected),'entries for review; details in docs/vocabulary-audit.json')
