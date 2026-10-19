// Applies the stored colour theme before first paint (external file so a strict CSP can forbid inline scripts).
try { var t = localStorage.getItem('qg.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* storage unavailable */ }
