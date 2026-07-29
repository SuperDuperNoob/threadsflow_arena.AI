/**
 * n8n Code node — wf2 persona calibration.
 *
 * Input:
 *   $json.cfg.persona_snippets : [{id, domain, title, register, tags, text}]
 *   $json.tone                 : selected tone code from bandit
 *
 * Output:
 *   Adds persona_snippets + persona_fragment for the writer prompt.
 *
 * The snippets are style/rhythm references only. They must never become facts in a product post.
 */

function shuffle(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toneRegisters(tone) {
  return ({
    warm_sibling: ['reflective', 'conversational'],
    deadpan: ['neutral', 'informative'],
    minimal: ['neutral', 'informative'],
    gaul: ['conversational', 'neutral'],
    chaotic: ['conversational'],
    enthusiast: ['conversational', 'informative'],
    corporate_parody: ['formal', 'informative'],
  })[tone] ?? ['conversational', 'neutral', 'reflective'];
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function pickPersonaSnippets(input) {
  const all = input.persona_snippets ?? input.cfg?.persona_snippets ?? [];
  if (!Array.isArray(all) || !all.length) return { persona_snippets: [], persona_fragment: '' };

  const preferred = toneRegisters(input.tone);
  const ranked = all
    .map(s => ({ ...s, text: clean(s.text), score: preferred.includes(s.register) ? 2 : 0 }))
    .filter(s => s.text.length >= 80 && s.text.length <= 750)
    .sort((a, b) => b.score - a.score || Math.random() - 0.5);

  const picked = shuffle(ranked.slice(0, 12)).slice(0, 3);
  if (!picked.length) return { persona_snippets: [], persona_fragment: '' };

  const lines = picked.map((s, i) => {
    const label = [s.register, s.domain].filter(Boolean).join(' · ');
    return `${i + 1}. (${label}) ${s.text.slice(0, 520)}`;
  });

  return {
    persona_snippets: picked,
    persona_fragment: `\n### Persona calibration — Malaysian cadence references\nThese are NOT facts and NOT templates. Borrow only rhythm, sentence pressure, and Malay register. Do not copy wording, claims, religious advice, or topic.\n${lines.join('\n')}\n`,
  };
}

const picked = pickPersonaSnippets($json);
return [{ json: { ...$json, ...picked } }];
