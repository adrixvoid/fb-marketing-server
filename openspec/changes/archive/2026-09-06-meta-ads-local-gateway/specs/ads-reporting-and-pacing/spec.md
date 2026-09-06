# Ads Reporting and Pacing Specification

## Purpose

Define independently scoped campaigns, Insights metrics, explicit unavailable values, and exact timezone-aware monthly pacing. (FR-4, FR-7, FR-10, FR-12–14, FR-18–19)

## Requirements

### Requirement: Authorized scoped reporting

Campaign, Insights, and pacing reads MUST require one resolved client and Ad Account pair and MUST execute without approval after authorization. The service MUST expose no unscoped Meta reporting endpoint.

#### Scenario: Independent account read

- GIVEN two authorized Ad Accounts for one pilot client
- WHEN each account is queried separately
- THEN each response MUST identify only its requested resolved scope and MUST contain no sibling-account data

#### Scenario: Valid empty Insights query

- GIVEN a semantically supported Insights query with no rows
- WHEN the query completes
- THEN the service MUST return `200` with an empty page rather than `422`

### Requirement: Typed metrics and unavailable values

Insights MUST support spend, impressions, reach, clicks, CTR, CPC, CPM, results, conversions, cost per result, and ROAS. Each metric MUST contain a typed value or an actionable unavailable reason; missing data MUST NOT be represented as zero. `422` MUST be reserved for semantically unsupported queries or metrics.

#### Scenario: Partial metric availability

- GIVEN Meta returns spend but lacks ROAS value data
- WHEN metrics are normalized
- THEN spend MUST be available and ROAS MUST be unavailable with its reason, not zero

#### Scenario: Unsupported metric

- GIVEN a query requests a metric outside the supported semantics
- WHEN validation runs
- THEN the service MUST return `422` before treating it as an empty result

### Requirement: Exact account-timezone pacing

Each Ad Account MUST have an independent fixed monthly budget and use its Meta-configured timezone and exact elapsed time for month boundaries. The result MUST expose scope, currency, timezone, reporting month, budget, MTD spend, remaining, elapsed fraction, expected spend, variance, projection, and `linear_elapsed_time`; a missing timezone MUST retain currency and budget while marking the reporting month and every timezone-dependent or derived value unavailable with `timezone_unavailable`.

#### Scenario: Known timezone

- GIVEN timezone, monthly budget, MTD spend, and an instant within the month
- WHEN pacing is calculated
- THEN `remaining = budget - spend`, expected spend uses exact elapsed fraction, variance uses spend minus expected, and positive-progress projection uses spend divided by elapsed fraction

#### Scenario: Missing timezone

- GIVEN currency and monthly budget but no Meta timezone
- WHEN pacing is requested
- THEN no reporting month MUST be fabricated and every timezone-dependent or derived field MUST be unavailable with `timezone_unavailable`

#### Scenario: Exact month start

- GIVEN a known timezone at the exact first instant of a month
- WHEN pacing is calculated
- THEN elapsed fraction and expected spend MUST be zero and only projection MUST be unavailable

### Requirement: Decimal-safe independent budgets

Money MUST preserve source currency and round to its ISO 4217 minor unit with round-half-even; ratios MUST round to six decimal places with round-half-even. Overspend MUST remain negative. Campaign budgets, account spend limits, and monthly pacing budgets MUST remain distinct, and different currencies MUST NOT be silently summed, compared, or ranked.

#### Scenario: Global operational composition

- GIVEN authorized scopes with different currencies
- WHEN OpenClaw builds a global table from one pacing response per pair
- THEN rows MUST remain independent with client identity and MUST contain no ranking, comparison, or cross-currency aggregate
