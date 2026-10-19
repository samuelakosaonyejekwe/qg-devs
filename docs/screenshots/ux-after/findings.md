# UX audit findings (before fixes)

Base: http://127.0.0.1:8788 · generated 2026-10-19T20:33:31.149Z

## Access / limit flows

- preregistration without token: {"flow":"preregistration without token","friendlyNotice":false,"rawErrorText":false}
- dataset ingest without token: {"flow":"dataset ingest without token","friendlyNotice":false,"rawErrorText":false}
- job limit (429): {"flow":"job limit (429)","friendlyNotice":false,"note":"no limit notice after 5 submissions (jobs may finish faster than they are submitted, or the limit is not per-tab)"}

## text: null value (8)

| route | viewport | element | text | screenshot |
|---|---|---|---|---|
| /suite/lab | desktop | `li` | Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charg | 001-desktop-suite-lab-text-null-value.png |
| /suite/lab | desktop | `span` | one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero | 002-desktop-suite-lab-text-null-value.png |
| /suite/falsification | desktop | `p.small.muted` | null hypothesis (no gravitational coupling) | 003-desktop-suite-falsification-text-null-value.png |
| /suite/lab | phone | `li` | Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charg | 032-phone-suite-lab-text-null-value.png |
| /suite/lab | phone | `span` | one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero | 033-phone-suite-lab-text-null-value.png |
| /suite/falsification | phone | `p.small.muted` | null hypothesis (no gravitational coupling) | 035-phone-suite-falsification-text-null-value.png |
| /suite/lab | desktop (dark) | `li` | Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charg | 048-desktop-suite-lab-text-null-value.png |
| /suite/lab | desktop (dark) | `span` | one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero | 049-desktop-suite-lab-text-null-value.png |

## unformatted long number (22)

| route | viewport | element | text | screenshot |
|---|---|---|---|---|
| /suite/data | desktop | `td.num` | 1.054571817 × 10⁻³⁴ | 004-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 6.62607015 × 10⁻³⁴ | 005-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 2.99792458 × 10⁸ | 006-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.602176634 × 10⁻¹⁹ | 007-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 8.8541878188 × 10⁻¹² | 008-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.25663706127 × 10⁻⁶ | 009-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.66053906892 × 10⁻²⁷ | 010-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 9.1093837139 × 10⁻³¹ | 011-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 9.2740100657 × 10⁻²⁴ | 012-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 2.00231930436 | 013-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 6.02214076 × 10²³ | 014-desktop-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.054571817 × 10⁻³⁴ | 037-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 6.62607015 × 10⁻³⁴ | 038-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 2.99792458 × 10⁸ | 039-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.602176634 × 10⁻¹⁹ | 040-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 8.8541878188 × 10⁻¹² | 041-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.25663706127 × 10⁻⁶ | 042-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.66053906892 × 10⁻²⁷ | 043-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 9.1093837139 × 10⁻³¹ | 044-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 9.2740100657 × 10⁻²⁴ | 045-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 2.00231930436 | 046-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 6.02214076 × 10²³ | 047-phone-suite-data-unformatted-long-number.png |

## element overflows viewport (19)

| route | viewport | element | text | screenshot |
|---|---|---|---|---|
| /builder | phone | `math` | math right=392 text="∣LL⟩,∣LR⟩,∣RL⟩,∣RR⟩\|LL\rangle, \|LR\rangle, \|RL\rangle, \|RR\rangle" | 015-phone-builder-element-overflows-viewport.png |
| /builder | phone | `math` | math right=370 text="max⁡ij ∣ρijengine−ρijref∣\max_{ij}\,\bigl\|\rho^{\mathrm{engine}}_{ij} - \rho^{\m" | 016-phone-builder-element-overflows-viewport.png |
| /builder | phone | `math` | math right=365 text="Δφch=−tℏ(ULL+URR−ULR−URL)\Delta\varphi_{\mathrm{ch}} = -\frac{t}{\hbar}\left(U_{" | 017-phone-builder-element-overflows-viewport.png |
| /help | phone | `math` | math right=401 text="φLL+φRR−φLR−φRL\varphi_{LL} + \varphi_{RR} - \varphi_{LR} - \varphi_{RL}" | 018-phone-help-element-overflows-viewport.png |
| /help | phone | `math` | math right=374 text="i,j∈{L,R}i, j \in \{L, R\}" | 019-phone-help-element-overflows-viewport.png |
| /help | phone | `math` | math right=364 text="N=C=0\mathcal{N} = C = 0" | 020-phone-help-element-overflows-viewport.png |
| /suite/quantum | phone | `math` | math right=406 text="ρ˙=−i[H,ρ]+∑k(LkρLk†−12{Lk†Lk,ρ})\dot\rho = -i[H,\rho] + \sum_k \bigl(L_k\rho L_" | 021-phone-suite-quantum-element-overflows-viewport.png |
| /suite/qg-eft | phone | `math` | math right=486 text="Δφq=φLL+φRR−φLR−φRL\Delta\varphi_q = \varphi_{LL} + \varphi_{RR} - \varphi_{LR} " | 022-phone-suite-qg-eft-element-overflows-viewport.png |
| /suite/qg-eft | phone | `math` | math right=390 text="φij=−Uij(q) t/ℏ\varphi_{ij} = -U^{(q)}_{ij}\,t/\hbar" | 023-phone-suite-qg-eft-element-overflows-viewport.png |
| /suite/entanglement | phone | `math` | math right=491 text="Δφ=φLL+φRR−φLR−φRL\Delta\varphi = \varphi_{LL} + \varphi_{RR} - \varphi_{LR} - \" | 024-phone-suite-entanglement-element-overflows-viewport.png |
| /suite/entanglement | phone | `math` | math right=392 text="∣LL⟩,∣LR⟩,∣RL⟩,∣RR⟩\|LL\rangle, \|LR\rangle, \|RL\rangle, \|RR\rangle" | 025-phone-suite-entanglement-element-overflows-viewport.png |
| /suite/entanglement | phone | `math` | math right=370 text="max⁡ij ∣ρijengine−ρijref∣\max_{ij}\,\bigl\|\rho^{\mathrm{engine}}_{ij} - \rho^{\m" | 026-phone-suite-entanglement-element-overflows-viewport.png |
| /suite/entanglement | phone | `math` | math right=365 text="Δφch=−tℏ(ULL+URR−ULR−URL)\Delta\varphi_{\mathrm{ch}} = -\frac{t}{\hbar}\left(U_{" | 027-phone-suite-entanglement-element-overflows-viewport.png |
| /suite/interferometry | phone | `math` | math right=365 text="φij=−1ℏ∫Uij(t) dt\varphi_{ij} = -\frac{1}{\hbar}\int U_{ij}(t)\,\mathrm{d}t" | 028-phone-suite-interferometry-element-overflows-viewport.png |
| /suite/decoherence | phone | `math` | math right=443 text="∣ρLR(t)∣=∣ρLR(0)∣ e−Γt\|\rho_{LR}(t)\| = \|\rho_{LR}(0)\|\,e^{-\Gamma t}" | 029-phone-suite-decoherence-element-overflows-viewport.png |
| /suite/decoherence | phone | `math` | math right=396 text="∣ρLR(t)/ρLR(0)∣\|\rho_{LR}(t)/\rho_{LR}(0)\|" | 030-phone-suite-decoherence-element-overflows-viewport.png |
| /suite/environment | phone | `math` | math right=393 text="r6=23ℏcR6cm24πGm2 ratior^6 = \dfrac{23\hbar c R^6 c_m^2}{4\pi G m^2\,\mathrm{rat" | 031-phone-suite-environment-element-overflows-viewport.png |
| /suite/inference | phone | `math` | math right=522 text="Δφ=λ ΔφNewton(design)\Delta\varphi = \lambda\,\Delta\varphi_{\mathrm{Newton}}(\t" | 034-phone-suite-inference-element-overflows-viewport.png |
| /suite/discovery | phone | `math` | math right=430 text="ln⁡Δφ=c+∑ieiln⁡xi\ln\Delta\varphi = c + \sum_i e_i \ln x_i" | 036-phone-suite-discovery-element-overflows-viewport.png |

