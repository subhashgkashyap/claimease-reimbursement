# Installing ClaimEase on a new instance

> **Not yet tested end to end.** These update sets were generated from the source instance's own
> unload XML and verified to be well-formed, with every payload round-tripping back to the correct
> table, action and field set. They have **not** been imported into a target instance, because no
> second instance was available. Treat the first install as a rehearsal on a throwaway PDI, and
> **Preview before you Commit** — the preview is what will tell you if anything is missing.

Steps 4, 5 and 6 are not optional. They cover things that cannot be exported as application
metadata, and skipping them leaves an application that looks installed but misbehaves — in step 4's
case, silently.

---

## 1. Prerequisites

- A ServiceNow instance you can log into as `admin` (the UI is required; a web-service-only
  account cannot import update sets).
- The instance must not already have a scope named `x_2180676_claime_0`.
- Plugins: Service Portal and Flow Designer, both active by default on current releases.

---

## 2. Import the application

1. **System Update Sets → Retrieved Update Sets**
2. **Import Update Set from XML**, upload `update-sets/claimease-full-app.xml`
3. Open the loaded set, **Preview Update Set**
4. Resolve anything the preview reports, then **Commit Update Set**

804 entries will load: the application record, 2 tables, 32 dictionary fields, 10 ACLs with 26 role
grants, 4 roles, 6 script includes, 8 business rules, 5 Flow Designer flows with their snapshots,
the Service Portal and its 3 widgets, the record producer and its 6 variables, 12 notifications,
and the 13 configuration properties.

**If the preview reports problems with flows**, commit the rest, then open each flow in Flow
Designer and republish it. Flow snapshots are version-sensitive and are the most likely part of a
cross-instance move to need a nudge. The five flows are:

- ClaimEase – Reimbursement Approval Flow *(the trigger: `record_create_or_update` on the claim
  table, condition `approval_status=submitted`, strategy `unique_changes`)*
- ClaimEase - Request Manager Approval
- ClaimEase - Request Parallel Approval
- ClaimEase - Request Finance Group Approval
- ClaimEase - Record Approval Decision

---

## 3. Import the global business rules

Repeat step 2 with `update-sets/claimease-global-rules.xml`.

These two rules are in the **global** scope and are therefore absent from the application export.
Without them the receipt requirement is not enforced on any path except editing a draft, which is
the original Defect 1:

| Rule | Table | When | Order |
|---|---|---|---|
| `ClaimEase - Enforce Receipt On Submitted` | `x_2180676_claime_0_claim` | `async_always` | 2000 |
| `ClaimEase - Restore Claim On Receipt` | `sys_attachment` | `after` insert | 2000 |

The first uses `setWorkflow(false)` deliberately — its header comment explains why, and it is not a
mistake to tidy up. Read it before changing it.

---

## 4. Recreate the unique index on the lock table — **required**

The five `sys_index` records could not be exported: the table refuses both XML export (HTTP 403)
and REST reads. One of them is load-bearing.

`ClaimEaseLock._insertLock` decides whether another transaction already holds the per-employee
submission mutex by attempting an insert and **catching the unique-index violation**. If the index
is missing, the insert succeeds, both transactions believe they hold the lock, and duplicate
detection stops being race-safe. Nothing errors and nothing is logged — it just quietly stops
working under concurrency.

Create it:

1. **System Definition → Tables →** `ClaimEase Submission Lock` (`x_2180676_claime_0_claim_lock`)
2. Related Links → **Database Indexes → New**
3. Column: `lock_key` · **Unique: true**
4. Save, and wait for the index to build

Then confirm the behaviour rather than assuming it: submit two claims for the same employee in
immediate succession and check the second is judged a duplicate rather than accepted.

---

## 5. Create the two groups — **required**

The configuration references these groups **by name**, so they must match exactly. They are
`sys_user_group` records, which are data and do not travel with the application.

| Group name | Used for |
|---|---|
| `ClaimEase Finance Approvers` | The Finance approval step (`finance_group`) |
| `ClaimEase Claim Administrators` | The exception queue when no manager can be resolved (`fallback_approver_group`) |

If a name does not match, `resolveManager` falls back and every claim lands in the exception queue
with `exception_reason` set, rather than routing to an approver.

Add at least one member to each. For the Finance group, add **a member who does not hold `admin`** —
otherwise the field- and record-level ACLs cannot be tested at the privilege level they are written
for. That gap is why one ACL case was never verified on the source instance.

---

## 6. Currency configuration — **required**

The application normalises every amount to `base_currency` (USD). On the source instance this was
simplified so that USD is the only currency in play:

1. **System Localization → Currencies** — leave only `USD` active
2. Set `glide.i18n.single_currency` to `true`, and `glide.i18n.single_currency.code` to `USD`

Both are instance-wide platform configuration, not application metadata.

**Why this is not cosmetic.** `ClaimEaseCurrency.toBaseCurrency` treats a bare number as already
being in the base currency, and `GlideRecord.getValue()` on a currency field returns exactly that —
a bare number in the submitter's session currency. With one currency that assumption is true. With
several it is false, and claims are recorded at their foreign face value: on the source instance a
claim of INR 50 (about $0.53) was stored as `amount_usd = 50`, which pushed it over the $50
threshold, onto the wrong approval path, and out of duplicate detection entirely.

If you need genuine multi-currency support, fix `toBaseCurrency` to read the currency field's
reference value before you activate a second currency.

---

## 7. User data prerequisites

The application resolves an approver from `sys_user.manager` and notifies by `sys_user.email`.
For any employee expected to submit a claim:

- `email` must not be empty — on both the employee **and** their manager, or notifications go nowhere
- `manager` must be set and point to an **active** user
- the employee needs `x_2180676_claime_0.employee`

Note that two platform service accounts normally cannot be given an email at all
(`mms-service-account` is protected by a stock business rule, `playbook.automation_runner` by an
ACL). Leave them out rather than fighting them.

---

## 8. Verify the install

These are the scenarios that were run against the source instance after the fixes. Each is a claim
submitted through the Service Portal unless noted.

| # | Submit | Expect |
|---|---|---|
| 1 | 40 (below threshold) | `amount_usd` 40, parallel path: manager **and** both Finance approvers |
| 2 | A second claim below threshold, same employee | Parked as `duplicate`, `duplicate_of` set, **no approval started** |
| 3 | 105 (above threshold) | Sequential path: the manager alone |
| 4 | 50 exactly | Treated as large — sequential, and not duplicate-checked |
| 5 | Insert as `submitted` over the Table API with no attachment | Returned to `draft`, no actionable approval |
| 6 | As 5, then attach a receipt | Restored to Pending Manager Approval with a **fresh** approval record |
| 7 | Save a draft, attach a receipt, do not submit | Stays `draft` — must not submit itself |

7 is the one people forget: it proves the restore rule does not hijack a draft someone saved on
purpose. It works because the restore only fires on a claim carrying a cancelled approval, which a
never-submitted draft does not have.

Also confirm the per-employee mutex, per step 4.

---

## 9. The supported alternative

`update-sets/claimease-full-app.xml` was generated from exported XML by `tools/build_updateset.py`,
not produced by Studio. It is faithful — the payloads are the platform's own serialization, copied
verbatim — but it is not the vendor-supported route.

If you still have access to a working instance, the supported routes are better, and either gives
you a cleaner path to every future instance:

- **Studio → Source Control → Link to Source Control**, pointing at this GitHub repository. A new
  instance can then **Import from Source Control** and get the application directly. This is the
  best answer to "I want to use this anywhere", and it keeps the scoped app's own history.
- **Studio → Publish to Update Set**, which produces a Studio-generated set you can commit here
  alongside the generated one.

Both need the UI, so neither could be done from the web-service-only account used for this export.
Steps 3 to 7 still apply afterwards: source control carries the scoped application, and nothing
else on that list is in it.
