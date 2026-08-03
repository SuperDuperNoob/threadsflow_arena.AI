import fs from 'node:fs';
import path from 'node:path';

const WORKFLOWS_DIR = './n8n/workflows';
const CODE_DIR = './n8n/code';

const mappings = [
  {
    file: 'wf2_generate.json',
    replacements: [
      { nodeName: 'Build slot plan', sourceFile: 'slot_plan.js' },
      { nodeName: 'Bandit: pick arm', sourceFile: 'bandit.js' },
      { nodeName: 'Persona: Malay cadence', sourceFile: 'persona_picker.js' },
      { nodeName: 'Pick devices', sourceFile: 'technique_picker.js' },
      { nodeName: 'QA gate', sourceFile: 'qa.js' },
    ]
  },
  {
    file: 'wf4_evaluate.json',
    replacements: [
      { nodeName: 'Score cycle', sourceFile: 'scoring.js' },
      { nodeName: 'Update arms + plan', sourceFile: 'bandit.js' },
      { nodeName: 'Update techniques', sourceFile: 'technique_picker.js' },
    ]
  },
  {
    file: 'wf6_persona.json',
    replacements: [
      { nodeName: 'Build persona slots', sourceFile: 'persona_slot_plan.js' },
      { nodeName: 'Pick persona topic', sourceFile: 'persona_topic_pick.js' },
      { nodeName: 'Persona: Malay cadence', sourceFile: 'persona_picker.js' },
      // 'Build prompts' is hand-coded in build_wf6.mjs and reads the persona_writer.md prompt at build time.
      // 'Persona QA gate' pulls qa_persona.js; we inject it here so edits to qa_persona.js are picked up.
      { nodeName: 'Persona QA gate', sourceFile: 'qa_persona.js' },
    ]
  },
  {
    file: 'wf7_l4_reply.json',
    replacements: [
      { nodeName: 'Plan replies', sourceFile: 'l4_reply_plan.js' },
      { nodeName: 'Classify intent', sourceFile: 'l4_classify_intent.js' },
      { nodeName: 'Draft reply prompt', sourceFile: 'l4_draft_reply.js' },
      { nodeName: 'QA gate', sourceFile: 'l4_qa_reply.js' },
    ]
  }
];

function populateWorkflows() {
  for (const item of mappings) {
    const filePath = path.join(WORKFLOWS_DIR, item.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Workflow file not found: ${filePath}`);
      continue;
    }

    console.log(`Processing workflow: ${item.file}`);
    const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let modified = false;

    for (const rep of item.replacements) {
      const sourcePath = path.join(CODE_DIR, rep.sourceFile);
      if (!fs.existsSync(sourcePath)) {
        console.error(`  Source code file not found: ${sourcePath}`);
        continue;
      }

      const jsCodeContent = fs.readFileSync(sourcePath, 'utf8');
      const node = workflow.nodes.find(n => n.name === rep.nodeName);

      if (node) {
        if (!node.parameters) node.parameters = {};
        node.parameters.jsCode = jsCodeContent;
        console.log(`  -> Successfully injected ${rep.sourceFile} into node "${rep.nodeName}"`);
        modified = true;
      } else {
        console.warn(`  -> Warning: Node "${rep.nodeName}" not found in workflow ${item.file}`);
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
      console.log(`Saved updated workflow: ${filePath}\n`);
    }
  }
}

populateWorkflows();
