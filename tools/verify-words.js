'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = path.join(__dirname, '../src/data');
const read = name => JSON.parse(fs.readFileSync(path.join(data, name), 'utf8'));
const lexicon = read('lexicon.json'), catalog = read('catalog.json'), examples = read('examples.json');
const minimum = {primary:1000,junior:1700,senior:3700,cet4:5300,cet6:7000,ielts:5800,toefl:8200};
const pos = new Set(['n.','v.','adj.','adv.','prep.','conj.','pron.','num.','phr.','art.','int.','det.','aux.','abbr.']);
const used = new Set();
for (const [key, word] of Object.entries(lexicon)) {
  for (const field of ['en','zh','pos','ipa','source','ipaSource','accent']) {
    assert.equal(typeof word[field], 'string', key+' '+field);
    assert.ok(word[field].trim() && word[field]===word[field].trim(),key+' '+field);
    assert.ok(!word[field].includes('\uFFFD') && !word[field].includes('\\n'),key+' damaged '+field);
  }
  assert.ok(pos.has(word.pos),key+' unknown part of speech');
  assert.match(word.ipa,/^\/[^/\n]+\/$/,key+' IPA');
  assert.ok(word.zh.length<=40,key+' quiz gloss too long');
  assert.ok(word.senses?.length,key+' no detailed senses');
  for (const sense of word.senses) {assert.ok(pos.has(sense.pos),key+' sense POS');assert.match(sense.zh,/[\u4e00-\u9fff]/,key+' sense Chinese');}
  if (word.exampleId) {
    const example=examples[word.exampleId];assert.ok(example,key+' example missing');
    assert.ok(example.en.toLowerCase().includes(word.en.toLowerCase()),key+' example not aligned');
    assert.ok(example.zh && example.attribution.includes('CC-BY 2.0 (France)'),key+' example credit');
    assert.equal((example.attribution.match(/#\d+ \([^)]+\)/g)||[]).length,2,key+' missing sentence owner');
    assert.match(example.url,/^https:\/\/tatoeba.org\/en\/sentences\/show\/\d+$/);
    used.add(word.exampleId);
  }
}
let total=0;
for (const [level, min] of Object.entries(minimum)) {
  const words=catalog.levels[level].words;
  assert.ok(words.length>=min,level+' truncated catalog');
  assert.equal(new Set(words).size,words.length,level+' duplicate key');
  const seen=new Set();
  for(const key of words){assert.ok(lexicon[key],level+' missing '+key);assert.ok(!seen.has(lexicon[key].en),level+' repeated headword');seen.add(lexicon[key].en);}
  total+=words.length;
  console.log(`${level.padEnd(8)} ${words.length} records, ${words.filter(key=>lexicon[key].exampleId).length} corpus examples`);
}
for (const [low, high] of [['primary','junior'],['junior','senior'],['senior','cet4'],['cet4','cet6'],['junior','ielts'],['junior','toefl']]) {
  const next=new Set(catalog.levels[high].words);
  assert.ok(catalog.levels[low].words.every(key=>next.has(key)),high+' omits foundation');
}
assert.equal(used.size,Object.keys(examples).length,'orphan example');
console.log(`Verified ${Object.keys(lexicon).length} distinct words, ${total} catalog records, ${used.size} attributed examples.`);
