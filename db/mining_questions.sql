-- The 30 mining questions. Paste each into your NotebookLM chat, copy the answer back into
-- `raw_answer`, then run scripts/mine_techniques.mjs.
--
-- Design principle: ask for MECHANISMS and RULES, never for summaries. A summary gives you
-- prose you can't act on. A mechanism gives you an imperative sentence the writer LLM can execute.
--
-- Every question ends with a format demand, because NotebookLM will otherwise write essays.

INSERT INTO mining_questions (ord, question, target) VALUES

-- ═══ HOOKS / OPENINGS (the highest-leverage 3 seconds)
(1, 'List every distinct technique in these sources for opening a piece of copy so the reader cannot stop reading. For each one give: (a) a short name, (b) the psychological mechanism in one sentence, (c) one concrete example sentence, (d) one near-miss example that fails and why. Do not summarise — enumerate. Aim for at least 15.', 'hook'),
(2, 'What do these sources say about the FIRST FIVE WORDS specifically? Any rules, patterns, or word categories that should or should not appear there? Give concrete rules I could check mechanically.', 'hook'),
(3, 'Which opening techniques in these sources rely on curiosity, and which rely on self-interest or fear? Separate them into two lists and note when each is preferred.', 'hook'),

-- ═══ ANTI-PATTERNS (the single most valuable extraction — feeds banned_phrases)
(4, 'What do these sources say makes copy sound fake, salesy, hyped, or untrustworthy? List every specific word, phrase, punctuation habit, or sentence structure to avoid. Be exhaustive and literal — I want the actual words, not the principle.', 'anti_pattern'),
(5, 'What phrases or constructions do these sources call cliché, worn out, or meaningless in advertising? Give the literal phrases.', 'anti_pattern'),
(6, 'What do these sources say about adjectives and adverbs in persuasive copy? Which specific ones are called weak, empty, or unbelievable?', 'anti_pattern'),
(7, 'According to these sources, what are the most common mistakes that mark copy as amateur? List them as things NOT to do, each in one imperative sentence.', 'anti_pattern'),

-- ═══ SOFT SELLING (directly serves your sell_intensity 0 and 1 levers)
(8, 'What techniques do these sources give for selling WITHOUT appearing to sell? Enumerate each as a distinct, actionable technique.', 'psychology'),
(9, 'What do these sources say about the ratio of value or entertainment to selling? Any specific ratios, rules, or sequencing advice?', 'structure'),
(10, 'How do these sources recommend introducing a product AFTER the reader is already engaged, rather than at the start? Give the specific transition techniques.', 'structure'),

-- ═══ SPECIFICITY & PROOF (this is what kills generic AI copy)
(11, 'What do these sources say about specificity — concrete numbers, names, details, sensory description — versus general claims? Give the rules and the reasoning.', 'proof'),
(12, 'How do these sources recommend using a genuine flaw, drawback, or admission to increase credibility? Give the technique names and examples.', 'proof'),
(13, 'What techniques do these sources give for making a claim believable without exaggeration? Enumerate.', 'proof'),
(14, 'What do these sources say about using real customer language, reviews, or testimonials? What makes one convincing versus hollow?', 'proof'),

-- ═══ VOICE & RHYTHM (feeds the tone levers and the editor prompt)
(15, 'What do these sources say about writing the way people actually speak? Give concrete, checkable rules about sentence length, rhythm, and word choice.', 'voice'),
(16, 'What do these sources say about sentence length variation and paragraph rhythm? Any specific patterns recommended?', 'rhythm'),
(17, 'How do these sources describe building a distinctive, recognisable voice rather than a neutral corporate one? Enumerate the techniques.', 'voice'),
(18, 'What do these sources say about the difference between writing for one specific person versus writing for an audience? Give the practical techniques.', 'voice'),

-- ═══ STRUCTURE (may become new format levers)
(19, 'List every named copywriting structure or framework in these sources (for example AIDA, PAS, and any others). For each: the steps, what it is best suited for, and when it fails.', 'structure'),
(20, 'What do these sources say about how to END a piece of copy? Enumerate the closing techniques, including any that avoid an explicit call to action.', 'structure'),
(21, 'What techniques do these sources give for storytelling in persuasion — story shapes, how much detail, where the product enters the story?', 'structure'),

-- ═══ PSYCHOLOGY (may become new angle levers)
(22, 'Enumerate every psychological principle or trigger described in these sources. For each: the name, one sentence on the mechanism, and one concrete way to apply it in a short social media post.', 'psychology'),
(23, 'What do these sources say about objection handling — anticipating and dissolving doubt before it forms?', 'psychology'),
(24, 'What do these sources say about identity, belonging, and status as motivators versus practical benefit? When does each work better?', 'psychology'),

-- ═══ CTA
(25, 'What do these sources say about calls to action — wording, placement, how direct, how many? Include anything about low-pressure or indirect CTAs.', 'cta'),

-- ═══ SHORT-FORM & MODERN APPLICABILITY (critical filter for your use case)
(26, 'Which techniques in these sources are specifically suited to SHORT copy — under 500 characters — rather than long sales letters? List them and explain the adaptation needed.', 'structure'),
(27, 'Which techniques in these sources were designed for print, direct mail, or television and would likely BACKFIRE on a modern social feed where users are hostile to advertising? Be blunt and specific.', 'anti_pattern'),
(28, 'Which principles in these sources are timeless human psychology, and which are artefacts of the media era they were written in? Separate into two lists.', 'psychology'),

-- ═══ CONTESTED CLAIMS (your best experiments — the bandit can settle these)
(29, 'Where do these sources DISAGREE with each other? List every contested claim, who is on each side, and what each side argues. This is important — do not smooth over the disagreements.', 'psychology'),
(30, 'What claims in these sources are asserted confidently but without evidence? List them as testable hypotheses I could run an A/B test on.', 'psychology');

-- ── Optional follow-ups worth asking if your notebook is niche-specific:
-- 31. 'What do these sources say about writing for buyers of low-priced impulse products
--      (under $10) versus considered purchases?'
-- 32. 'What do these sources say about product photography and how copy should relate to the
--      image beside it?'
-- 33. 'What do these sources say about posting frequency, repetition, and how often the same
--      audience can see the same offer before it stops working?'
