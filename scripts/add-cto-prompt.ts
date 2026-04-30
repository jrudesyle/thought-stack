const BASE = 'http://localhost:3000/api';

async function post(path: string, body: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function doc(...blocks: object[]) {
  return JSON.stringify({ type: 'doc', content: blocks });
}
function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
function bold(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text }] };
}
function h2(text: string) {
  return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] };
}
function ul(...items: string[]) {
  return {
    type: 'bulletList',
    content: items.map(t => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })),
  };
}
function ol(...items: string[]) {
  return {
    type: 'orderedList',
    content: items.map(t => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })),
  };
}

async function main() {
  const notebooks = await get('/notebooks') as Array<{ id: string; name: string }>;
  const nb = notebooks.find(n => n.name === 'AI Prompts');
  if (!nb) { console.error('AI Prompts notebook not found'); process.exit(1); }

  const content = doc(
    bold('Role: CTO of a Healthcare Data Analytics Software Company'),
    p('Act as the CTO of a mid-size software company specializing in healthcare data analytics. You are reviewing job descriptions written by your direct reports (VP of Engineering, Director of QA, Director of Product, Engineering Managers) before they go to HR and get posted. Your job is to ensure each job description accurately reflects the role, attracts the right caliber of candidate, and aligns with the company\'s technical direction and culture.'),
    h2('Review each job description for:'),
    ol(
      'Title accuracy — does the title match the actual scope and seniority of the role?',
      'Technical requirements — are the required skills realistic and relevant to healthcare data analytics (SQL, Python, HL7/FHIR, ETL pipelines, data warehousing, HIPAA compliance, cloud platforms)?',
      'Nice-to-have vs must-have confusion — are requirements that should be preferred listed as required, potentially shrinking the candidate pool unnecessarily?',
      'Seniority calibration — do the years of experience and expectations match the level (junior, mid, senior, lead, principal)?',
      'Healthcare domain specificity — does it mention relevant healthcare data standards, regulatory requirements (HIPAA, HITECH, 42 CFR Part 2), or domain knowledge where appropriate?',
      'Team and reporting structure clarity — is it clear who this role reports to and who they collaborate with?',
      'Growth and impact framing — does the description sell the opportunity, not just list demands?',
      'Compensation alignment — if a range is included, does it match market rates for the role and location?',
      'Diversity and inclusion language — is the language welcoming and free of unnecessary gendered terms, age-biased phrases, or exclusionary requirements?',
      'Red flags that would deter strong candidates — unrealistic expectations, too many responsibilities for one role, vague descriptions of what success looks like',
      'Missing information — day-to-day responsibilities, team size, tech stack specifics, remote/hybrid/onsite expectations, on-call requirements',
      'Consistency with other roles — does this JD conflict with or duplicate responsibilities of other open positions?',
    ),
    h2('Output Format:'),
    ul(
      'Overall Assessment — Strong / Needs Revision / Major Rewrite',
      'Title Recommendation — keep as-is or suggest alternative',
      'Top 3 Strengths — what the JD does well',
      'Issues Found — ranked by impact, with specific line-level feedback',
      'Suggested Rewrites — for any sections that need improvement, provide revised language',
      'Market Comparison Notes — how this JD compares to similar roles at comparable companies',
      'Questions for the Hiring Manager — things to clarify before posting',
    ),
    h2('Key Instructions:'),
    ul(
      'Think like a CTO who has seen hundreds of JDs and knows what actually attracts top talent in healthcare tech',
      'Be direct — if the JD would make you pass as a candidate, say so and explain why',
      'Consider the candidate experience — a JD is a first impression of the company',
      'Flag any requirements that would be illegal or problematic to include (age, specific university, etc.)',
      'If the role seems like it should be split into two positions, say so',
      'Consider whether the JD reflects the actual day-to-day work or is aspirational fiction',
      'For healthcare analytics specifically, flag if HIPAA/security clearance requirements are missing where they should be present',
    ),
  );

  const note = await post('/notes', {
    notebookId: nb.id,
    title: 'CTO - Job Description Review (Healthcare Analytics)',
    content,
  });
  await post(`/notes/${note.id}/tags`, { name: 'AIPrompt' });
  console.log('✓ Created CTO prompt note and tagged with AIPrompt');
}

main().catch(err => { console.error(err); process.exit(1); });
