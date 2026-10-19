# UX audit findings (before fixes)

Base: http://127.0.0.1:8777 · generated 2026-10-19T17:02:28.881Z

## Access / limit flows

- preregistration without token: {"flow":"preregistration without token","friendlyNotice":true,"rawErrorText":false}
- dataset ingest without token: {"flow":"dataset ingest without token","friendlyNotice":true,"rawErrorText":false}
- job limit (429): {"flow":"job limit (429)","friendlyNotice":true,"refusedAtSubmission":1,"rawErrorText":false}

## unformatted long number (38)

| route | viewport | element | text | screenshot |
|---|---|---|---|---|
| /suite/interferometry | desktop | `td.num` | 0.49224928 | 001-desktop-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | desktop | `td.num` | 0.35160663 | 002-desktop-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | desktop | `td.num` | 0.44087619 | 003-desktop-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | desktop | `td.num` | 0.44087619 | 004-desktop-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | desktop | `td.num` | 0.49224928 | 005-desktop-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | desktop | `td.num` | 0.35160663 | 006-desktop-suite-interferometry-unformatted-long-number.png |
| /suite/decoherence | desktop | `td.num` | 0.96925289 | 007-desktop-suite-decoherence-unformatted-long-number.png |
| /suite/decoherence | desktop | `div.out-value` | 0.96925289 | 008-desktop-suite-decoherence-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.054571817 × 10⁻³⁴ | 012-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 6.62607015 × 10⁻³⁴ | 013-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 2.99792458 × 10⁸ | 014-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.602176634 × 10⁻¹⁹ | 015-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 8.8541878188 × 10⁻¹² | 016-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.25663706127 × 10⁻⁶ | 017-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 1.66053906892 × 10⁻²⁷ | 018-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 9.1093837139 × 10⁻³¹ | 019-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 9.2740100657 × 10⁻²⁴ | 020-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 2.00231930436 | 021-desktop-suite-data-unformatted-long-number.png |
| /suite/data | desktop | `td.num` | 6.02214076 × 10²³ | 022-desktop-suite-data-unformatted-long-number.png |
| /suite/interferometry | phone | `td.num` | 0.49224928 | 023-phone-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | phone | `td.num` | 0.35160663 | 024-phone-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | phone | `td.num` | 0.44087619 | 025-phone-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | phone | `td.num` | 0.44087619 | 026-phone-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | phone | `td.num` | 0.49224928 | 027-phone-suite-interferometry-unformatted-long-number.png |
| /suite/interferometry | phone | `td.num` | 0.35160663 | 028-phone-suite-interferometry-unformatted-long-number.png |
| /suite/decoherence | phone | `td.num` | 0.96925289 | 029-phone-suite-decoherence-unformatted-long-number.png |
| /suite/decoherence | phone | `div.out-value` | 0.96925289 | 030-phone-suite-decoherence-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.054571817 × 10⁻³⁴ | 034-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 6.62607015 × 10⁻³⁴ | 035-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 2.99792458 × 10⁸ | 036-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.602176634 × 10⁻¹⁹ | 037-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 8.8541878188 × 10⁻¹² | 038-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.25663706127 × 10⁻⁶ | 039-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 1.66053906892 × 10⁻²⁷ | 040-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 9.1093837139 × 10⁻³¹ | 041-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 9.2740100657 × 10⁻²⁴ | 042-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 2.00231930436 | 043-phone-suite-data-unformatted-long-number.png |
| /suite/data | phone | `td.num` | 6.02214076 × 10²³ | 044-phone-suite-data-unformatted-long-number.png |

## text: null value (8)

| route | viewport | element | text | screenshot |
|---|---|---|---|---|
| /suite/lab | desktop | `li` | Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charg | 009-desktop-suite-lab-text-null-value.png |
| /suite/lab | desktop | `span` | one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero | 010-desktop-suite-lab-text-null-value.png |
| /suite/falsification | desktop | `p.small.muted` | null | 011-desktop-suite-falsification-text-null-value.png |
| /suite/lab | phone | `li` | Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charg | 031-phone-suite-lab-text-null-value.png |
| /suite/lab | phone | `span` | one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero | 032-phone-suite-lab-text-null-value.png |
| /suite/falsification | phone | `p.small.muted` | null | 033-phone-suite-falsification-text-null-value.png |
| /suite/lab | desktop (dark) | `li` | Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charg | 045-desktop-suite-lab-text-null-value.png |
| /suite/lab | desktop (dark) | `span` | one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero | 046-desktop-suite-lab-text-null-value.png |

