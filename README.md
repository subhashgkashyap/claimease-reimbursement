# ClaimEase

A ServiceNow reimbursement-claim application: employees submit claims, managers review them, and
the Finance group validates and approves eligible ones. Approval routing is threshold-based,
duplicate prevention is server-enforced over a 90-day rolling window, access control is role- and
identity-based, and status changes raise email notifications.

- **Scope:** `x_2180676_claime_0`
- **Version:** 1.0.0
- **Exported from:** `dev314379.service-now.com` on 1 November 2026

This repository exists so the application survives the loss of that instance. It holds the
complete exported definition plus instructions for standing it up somewhere else.

---

## Why this repository is not just an update set

An update set alone is not enough to reproduce a working ClaimEase, because three kinds of thing
the application depends on are **not** application metadata and so cannot be exported with it:

| What | Why it does not travel | Where it is covered |
|---|---|---|
| Two **global-scope** business rules | They sit outside the scope, so a scoped-app export omits them entirely | `update-sets/claimease-global-rules.xml` |
| A **unique database index** on the lock table | `sys_index` refused export (HTTP 403) and is unreadable over REST | [INSTALL.md](INSTALL.md) step 4 — **must be recreated by hand** |
| Two **user groups**, referenced by name | `sys_user_group` is data, not metadata | [INSTALL.md](INSTALL.md) step 5 |
| Instance currency configuration | `fx_currency` rows and a platform property are data/config | [INSTALL.md](INSTALL.md) step 6 |

The index one matters most and is the least obvious. `ClaimEaseLock._insertLock` detects a
concurrent submission by *catching a unique-index violation*:

```js
// A unique-index violation is an expected, non-exceptional outcome.
```

Without that index the insert simply succeeds, two transactions both believe they hold the
per-employee mutex, and duplicate prevention silently stops being race-safe. Nothing fails loudly.
See INSTALL.md step 4.

---

## Repository layout

```
export/                     Platform unload XML, one file per table (62 files, 819 artifacts)
  sys_app.xml               The application record
  global__sys_script.xml    The two global-scope business rules
  sys_index.json            Placeholder: index export was refused, see INSTALL.md step 4
src/                        Human-readable source, for review and diffs (48 files)
  script_includes/          ClaimEaseValidator, ClaimEaseCurrency, ClaimEaseDuplicateCheck, ...
  business_rules_scoped/    The 8 rules on the claim table
  business_rules_global/    The 2 rules that live outside the scope
  record_producer/          "Submit a Reimbursement Claim" server script
  catalog_client_scripts/   Portal-side scripts
  notifications/            Email notification bodies
  portal_widgets/           Service Portal widget script/client/template/css
  mail_scripts/
update-sets/
  claimease-full-app.xml    804 entries: the whole scoped application
  claimease-global-rules.xml  2 entries: the global business rules
tools/                      The export scripts, so this repo can be refreshed
manifest.json               Per-table expected vs exported counts
```

`src/` is generated **from** the same records as `export/`; it is there to make the application
reviewable in a pull request. `export/` and `update-sets/` are what actually install it.

---

## Configuration

Thirteen properties ship with the application, so these defaults arrive with it:

| Property | Default | Meaning |
|---|---|---|
| `approval_threshold` | `50` | Claims below this take the parallel path, at or above it the sequential path |
| `threshold_boundary` | `sequential` | A claim exactly at the threshold is treated as large |
| `duplicate_window_days` | `90` | Rolling window for duplicate detection |
| `duplicate_exclude_cancelled` | `true` | Cancelled and already-duplicate claims do not block |
| `duplicate_exclude_rejected` | `false` | A rejected small claim still consumes the window |
| `require_receipt` | `true` | A claim cannot be approved without an attachment |
| `base_currency` | `USD` | Currency all amounts are normalised to |
| `finance_group` | `ClaimEase Finance Approvers` | Group matched **by name** |
| `fallback_approver_group` | `ClaimEase Claim Administrators` | Group matched **by name** |
| `finance_group_policy` | `anyone` | Any group member may record the Finance decision |
| `allow_delegated_submission` | `false` | `requested_for` is forced to the authenticated user |
| `allow_future_expense_date` | `false` | Expense dates cannot be in the future |
| `portal_suffix` | `claimease` | Service Portal lives at `/claimease` |

Duplicate detection is **one small claim per employee per 90 days** — it does not match on equal
amounts. Any second claim below the threshold inside the window is parked as a duplicate.

### Roles

| Role | Purpose |
|---|---|
| `x_2180676_claime_0.employee` | Submit claims; read only their own |
| `x_2180676_claime_0.manager` | Action the Manager step on claims where they are the recorded manager |
| `x_2180676_claime_0.finance_approver` | Action the Finance step |
| `x_2180676_claime_0.admin` | Configuration, exception queue, troubleshooting |

The manager check is **identity-based, not role-based**: holding the manager role is not enough,
you must be the `manager` recorded on that claim.

---

## Known issues carried over

Two defects were found, fixed and verified on the source instance before this export; both fixes
are included here.

1. **Receipt not enforced on insert-as-submitted.** The validator asked for the receipt check only
   on update, so a claim created already `submitted` was never checked. Fixed by the async
   `ClaimEase - Enforce Receipt On Submitted` rule.
2. **A receipt arriving in a second request killed a good claim.** The async rule reverted a claim
   whose receipt landed moments after the insert. Fixed by `ClaimEase - Restore Claim On Receipt`,
   plus resetting the approval decision fields on revert so the flow can re-trigger.

Still open, and unchanged by this export:

- A claim can stay permanently marked `duplicate` of a claim that was later invalidated; nothing
  re-evaluates a parked duplicate. Low severity, does not self-correct.
- There is no ATF coverage anywhere in the application.
- Foreign-currency handling was resolved by restricting the instance to USD rather than by fixing
  `ClaimEaseCurrency.toBaseCurrency`, which still treats a bare number as already being in the base
  currency. **If you install this on an instance with more than one active currency, that defect
  returns.** See INSTALL.md step 6.

---

## Refreshing this repository

`tools/` holds the scripts that produced everything here. They need a `sn.hdr` curl config
containing an `Authorization: Basic ...` header for an account that can read the instance, and an
`inventory.json` produced by the first step. See [tools/README.md](tools/README.md).
