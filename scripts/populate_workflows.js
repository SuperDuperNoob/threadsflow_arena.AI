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
