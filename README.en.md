**English** | [中文](README.md)

# WordMaster — An Offline Vocabulary Trainer for Windows

WordMaster is a desktop app built with Electron for learners who want one tool covering every stage of English study. It runs entirely offline, stores all data locally, and ships with 5,572 curated words across seven levels — every one of them with a worked example sentence and its Chinese translation.

![Home screen (dark theme)](docs/screenshots/01-home-dark.png)

<table>
<tr>
<td width="50%"><img src="docs/screenshots/02-study-question.png" alt="Quiz screen"><br><sub>Chinese&rarr;English multiple choice</sub></td>
<td width="50%"><img src="docs/screenshots/03-answer-correct.png" alt="Correct answer"><br><sub>Correct: green highlight + rising chime</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/04-answer-wrong.png" alt="Wrong answer"><br><sub>Wrong: the answer is shown, the word returns later</sub></td>
<td><img src="docs/screenshots/07-home-light.png" alt="Light theme"><br><sub>Light theme (one-click switch)</sub></td>
</tr>
</table>

## Features

**Study scope, your choice.** Enable any combination of seven word banks — Primary (200), Junior High (220), Senior High (1,031), CET-4 (1,027), CET-6 (1,032), IELTS (1,030), TOEFL (1,032) — or use one-click presets for domestic curricula versus overseas exams. When several levels are active, new words are drawn from each in turn, so a session never drifts into a single bank.

**Both directions.** Words can be tested English-to-Chinese, Chinese-to-English, or a random mix. Chinese-to-English questions reveal the spelling and phonetic transcription after you answer, so sound and meaning are learned together. Any word can also be read aloud by the system's speech engine.

**Multiple choice, with real feedback.** Four options per question, answerable by number or letter key. Distractors come from the same level and part of speech, keeping choices plausible rather than guessable. Correct answers play a bright rising chime; wrong answers a low descending slide. Both are synthesized live with the Web Audio API, so no audio file can ever go missing.

**Reviews that actually work.** Everything learned today returns tomorrow. Answer correctly and the interval stretches: 1, 2, 4, 7, 15, then 30 days. Answer wrong and the word drops back to tomorrow. Only a full run marks a word mastered.

**A full entry card when you get it right.** Answer correctly and the feedback strip expands into the word's phonetic transcription, part of speech, meaning, example sentence with Chinese translation, source word bank, review level and next review date — with a speaker button on both the word and the example. It can be switched off in Settings (`答对后展开详细词条`); while it is on, auto-advance waits at least 3.2 seconds so there is time to read.

**Light and dark.** One title-bar toggle switches themes instantly, native window controls included. Set your daily target anywhere from 5 to 200 words.

Round it out with a searchable wordbook, learning curves, accuracy statistics, streak tracking, JSON backup and restore, and automatic retry of missed words.

## Running it

```bash
npm install
npm start
```

Or build a standalone release:

```bash
npm run build:portable    # green/portable build, no extra downloads needed
npm run build:installer   # NSIS installer via electron-builder
```

## Built to be examined

```bash
npm run check       # word-bank validation, self-check, and scheduling tests
npm test            # 36 assertions covering the review scheduler
npm run capture     # renders the app, screenshots every screen, audits interactivity
```

The scheduling logic carries 36 automated assertions, all 5,572 words are verified to yield four distinct options, and the interface is validated with real simulated mouse input — not scripted clicks that bypass hit testing.

## License

[MIT](LICENSE) © 2026 Shr.CS
