/** Static navigation model (works offline). Maturity/gaps are fetched live from GET /api/suites. */
export interface SuiteNav { n: number; slug: string; name: string; short: string }

export const SUITES: SuiteNav[] = [
  { n: 1, slug: 'quantum', name: 'Quantum Mechanics and Quantum-State Dynamics', short: 'Quantum dynamics' },
  { n: 2, slug: 'gravity', name: 'Classical Gravitation and Numerical Relativity', short: 'Classical gravity' },
  { n: 3, slug: 'qg-eft', name: 'Quantum Gravity and Effective Field Theory', short: 'QG & EFT' },
  { n: 4, slug: 'entanglement', name: 'Gravity-Mediated Entanglement and Quantum Information', short: 'Gravity-mediated entanglement' },
  { n: 5, slug: 'interferometry', name: 'Quantum and Matter-Wave Interferometry', short: 'Interferometry' },
  { n: 6, slug: 'optomechanics', name: 'Quantum Optomechanics and Massive Quantum Systems', short: 'Optomechanics' },
  { n: 7, slug: 'decoherence', name: 'Quantum Decoherence and Open Systems', short: 'Decoherence' },
  { n: 8, slug: 'environment', name: 'Electromagnetic and Environmental Interaction Physics', short: 'EM backgrounds' },
  { n: 9, slug: 'lab', name: 'Virtual Laboratory and Experimental Apparatus', short: 'Virtual laboratory' },
  { n: 10, slug: 'signal', name: 'Precision Measurement and Signal Processing', short: 'Measurement & signals' },
  { n: 11, slug: 'inference', name: 'Inverse Physics and Statistical Inference', short: 'Inference' },
  { n: 12, slug: 'falsification', name: 'Competing Gravity Models and Scientific Falsification', short: 'Competing models' },
  { n: 13, slug: 'design', name: 'Experimental Design and Optimisation', short: 'Design optimisation' },
  { n: 14, slug: 'discovery', name: 'AI-Driven Physical Law and Hypothesis Discovery', short: 'Law & hypothesis discovery' },
  { n: 15, slug: 'hpc', name: 'High-Performance Numerical Simulation', short: 'HPC & compute' },
  { n: 16, slug: 'verification', name: 'Calibration, Verification, Validation and Uncertainty', short: 'Verification & validation' },
  { n: 17, slug: 'data', name: 'Scientific Data, Visualisation and Research Management', short: 'Data' },
  { n: 18, slug: 'evidence', name: 'Discovery Evidence and Independent Replication', short: 'Evidence & replication' },
];

export const GROUPS: { title: string; suites: number[] }[] = [
  { title: 'Theory', suites: [2, 3, 12] },
  { title: 'Quantum simulation', suites: [1, 4, 5, 6, 7] },
  { title: 'Environment & apparatus', suites: [8, 9] },
  { title: 'Measurement & inference', suites: [10, 11, 13] },
  { title: 'AI & HPC', suites: [14, 15] },
  { title: 'Verification', suites: [16] },
  { title: 'Evidence & data', suites: [17, 18] },
];

export const suiteBySlug = (slug: string) => SUITES.find((s) => s.slug === slug);
export const suiteByN = (n: number) => SUITES.find((s) => s.n === n)!;
export const suitePath = (n: number) => `/suite/${suiteByN(n).slug}`;

export const TOOLS: { path: string; title: string; icon: string }[] = [
  { path: '/', title: 'Dashboard', icon: 'dash' },
  { path: '/thought-lab', title: 'Thought-Experiment Lab', icon: 'bulb' },
  { path: '/builder', title: 'Experiment Builder', icon: 'build' },
  { path: '/jobs', title: 'Jobs & history', icon: 'jobs' },
  { path: '/health', title: 'System health', icon: 'health' },
  { path: '/settings', title: 'Settings', icon: 'gear' },
  { path: '/help', title: 'Help & tutorials', icon: 'help' },
];
