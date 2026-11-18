# Judge calibration against human gold

`50` cases. `TPR` = catches a real defect; `TNR` = clears a clean translation. 95% Wilson interval.

> Provenance: 350 of 350 cells match the model-written draft unchanged, 0 were overridden by the human. **Under 20% overridden — treat this gold as draft-derived and say so wherever the numbers are used.**

## Pair level (all seven dimensions)

| judge | TP | FP | TN | FN | TPR | TNR |
|---|---|---|---|---|---|---|
| judge-a | 10 | 0 | 33 | 6 | 62.5% [38.6, 81.5] n=16 | 100.0% [89.6, 100.0] n=33 |
| judge-b | 14 | 1 | 32 | 3 | 82.3% [59.0, 93.8] n=17 | 97.0% [84.7, 99.5] n=33 |

## Cell level (case × dimension)

| judge | TP | FP | TN | FN | abstain | TPR | TNR |
|---|---|---|---|---|---|---|---|
| judge-a | 20 | 2 | 305 | 16 | 7 | 55.6% [39.6, 70.5] n=36 | 99.4% [97.7, 99.8] n=307 |
| judge-b | 34 | 17 | 294 | 5 | 0 | 87.2% [73.3, 94.4] n=39 | 94.5% [91.4, 96.6] n=311 |

## Per dimension (both judges pooled)

| dimension | TP | FP | TN | FN | TPR | TNR |
|---|---|---|---|---|---|---|
| meaning | 22 | 3 | 73 | 1 | 95.7% [79.0, 99.2] n=23 | 96.0% [89.0, 98.7] n=76 |
| entities_numbers | 5 | 5 | 81 | 8 | 38.5% [17.7, 64.5] n=13 | 94.2% [87.1, 97.5] n=86 |
| negation | 0 | 0 | 99 | 0 | n/a | 100.0% [96.3, 100.0] n=99 |
| omission | 9 | 4 | 83 | 3 | 75.0% [46.8, 91.1] n=12 | 95.4% [88.8, 98.2] n=87 |
| hallucination | 13 | 3 | 81 | 2 | 86.7% [62.1, 96.3] n=15 | 96.4% [90.0, 98.8] n=84 |
| terminology | 4 | 4 | 87 | 4 | 50.0% [21.5, 78.5] n=8 | 95.6% [89.2, 98.3] n=91 |
| fluency | 1 | 0 | 95 | 3 | 25.0% [4.6, 69.9] n=4 | 100.0% [96.1, 100.0] n=95 |

## Per set (both judges pooled, cell level)

| set | TP | FP | TN | FN | TPR | TNR |
|---|---|---|---|---|---|---|
| b1 | 53 | 18 | 546 | 20 | 72.6% [61.4, 81.5] n=73 | 96.8% [95.0, 98.0] n=564 |
| hardset | 1 | 1 | 53 | 1 | 50.0% [9.4, 90.5] n=2 | 98.2% [90.2, 99.7] n=54 |

## Every false negative and false positive

| judge | case | set | dim | human | judge | cell |
|---|---|---|---|---|---|---|
| P | B1-B-ascend/00009 | b1 | hallucination | F | P | FN |
| P | B1-B-ascend/00028 | b1 | entities_numbers | F | P | FN |
| P | B1-B-ascend/00028 | b1 | omission | F | P | FN |
| P | B1-B-ascend/00068 | b1 | fluency | F | P | FN |
| P | B1-B-fleurs-public-candidates/cmn_hans_cn/1668 | b1 | entities_numbers | F | P | FN |
| P | B1-B-fleurs-public-candidates/cmn_hans_cn/1675 | b1 | entities_numbers | F | P | FN |
| P | B1-B-fleurs-public-candidates/cmn_hans_cn/1675 | b1 | omission | F | P | FN |
| P | B1-B-fleurs-public-candidates/cmn_hans_cn/1675 | b1 | hallucination | F | P | FN |
| P | B1-B-fleurs-public-candidates/cmn_hans_cn/1675 | b1 | terminology | F | P | FN |
| P | B1-B-fleurs-public-candidates/cmn_hans_cn/1678 | b1 | meaning | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1668 | b1 | entities_numbers | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1669 | b1 | terminology | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1670 | b1 | entities_numbers | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1675 | b1 | terminology | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1675 | b1 | fluency | F | P | FN |
| F | B1-B-fleurs-public-candidates/en_us/1678 | b1 | entities_numbers | P | F | FP |
| F | B1-B-fleurs-public-candidates/en_us/1680 | b1 | omission | P | F | FP |
| P | HS-zh_92816176 | hardset | entities_numbers | F | P | FN |
| P | B1-B-ascend/00009 | b1 | omission | F | P | FN |
| F | B1-B-ascend/00028 | b1 | terminology | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1668 | b1 | meaning | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1668 | b1 | terminology | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1670 | b1 | omission | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1670 | b1 | terminology | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1671 | b1 | meaning | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1678 | b1 | entities_numbers | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1678 | b1 | hallucination | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1678 | b1 | terminology | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1680 | b1 | entities_numbers | P | F | FP |
| F | B1-B-fleurs-public-candidates/cmn_hans_cn/1680 | b1 | hallucination | P | F | FP |
| P | B1-B-fleurs-public-candidates/en_us/1668 | b1 | entities_numbers | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1669 | b1 | terminology | F | P | FN |
| P | B1-B-fleurs-public-candidates/en_us/1670 | b1 | entities_numbers | F | P | FN |
| F | B1-B-fleurs-public-candidates/en_us/1675 | b1 | entities_numbers | P | F | FP |
| P | B1-B-fleurs-public-candidates/en_us/1675 | b1 | fluency | F | P | FN |
| F | B1-B-fleurs-public-candidates/en_us/1678 | b1 | entities_numbers | P | F | FP |
| F | B1-B-fleurs-public-candidates/en_us/1678 | b1 | omission | P | F | FP |
| F | B1-B-fleurs-public-candidates/en_us/1678 | b1 | hallucination | P | F | FP |
| F | B1-B-fleurs-public-candidates/en_us/1680 | b1 | omission | P | F | FP |
| F | HS-zh_92816176 | hardset | meaning | P | F | FP |
