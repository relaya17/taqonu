# 00 — ATLAS System Contract

**Status:** Foundation  
**Audience:** All engineers working on ATLAS  
**Companions:** 01-ATLAS_AGENT_SYSTEM_SPEC.md · 02-ATLAS_AGENT_GOVERNANCE_SPEC.md · 03-ATLAS_ENGINEERING_RUNTIME_SPEC.md · 04-ATLAS_PRODUCTION_READINESS_CHECKLIST.md

---

## Executive Contract

```
The Agent proposes.
Governance authorizes.
Runtime enforces.
Verification proves.
Audit records.
Production Gate decides.
```

This is not a slogan. This is the division of authority in ATLAS.

---

## System Boundaries

ATLAS consists of five distinct authority layers. Information flows downward (intent). Evidence flows upward (proof). Authority never flows sideways.

```
┌─────────────────────────────────────────┐
│ 01  AGENT SYSTEM                        │
│     • Reasoning (model intent)          │
│     • Planning (agent proposal)         │
│     • Output: AgentProposal             │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ 02  GOVERNANCE & AUTHORIZATION          │
│     • Policy evaluation                 │
│     • Risk assessment                   │
│     • Approval decision                 │
│     • Output: ExecutionAuthorization    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ 03  EXECUTION GATE & RUNTIME            │
│     • Enforce authorization             │
│     • Enforce boundaries                │
│     • Enforce resource limits           │
│     • Invoke tool                       │
│     • Output: ExecutionResult           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ 04  VERIFICATION & EVIDENCE             │
│     • Verify execution correctness      │
│     • Correlate to intent               │
│     • Generate evidence                 │
│     • Output: VerificationReport        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ 05  AUDIT & RECONSTRUCTION              │
│     • Record execution event            │
│     • Correlate all IDs                 │
│     • Enable reconstruction             │
│     • Output: AuditEvent                │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ 06  PRODUCTION GATE                     │
│     • Verify required controls passed   │
│     • Reject if mandatory gates failed  │
│     • Release or block                  │
│     • Output: ReleaseDecision           │
└─────────────────────────────────────────┘
```

---

## Authority Rules

### Layer 1: Agent (Reasoning)

**Responsibilities:**
- Understand user intent
- Plan actions
- Propose execution
- Report findings
- Store verified knowledge

**Authority Boundary:**
- Agent **proposes**
- Agent **never** authorizes
- Agent **never** invokes tools directly
- Agent **never** creates governance decisions
- Agent **never** creates authorization tokens
- Agent **never** mutates protected resources
- Agent **never** mutates audit records

**Input/Output:**
```
Input:  UserTask + AuthorizedContext
Output: AgentProposal
```

**Invariants:**
- Agent reasoning is **never** an authorization mechanism
- Agent intent is **advisory**, never **authoritative**
- Agent cannot bypass any downstream layer

---

### Layer 2: Governance & Authorization (Deciding)

**Responsibilities:**
- Evaluate policy
- Calculate risk
- Require approval if needed
- Generate authorization token
- Enforce tenant boundaries

**Authority Boundary:**
- Governance **decides** (based on policy)
- Governance **never** executes tools
- Governance **never** mutates resources
- Governance **never** creates runtime context
- Governance **never** bypasses approval requirements
- Governance **never** mutates audit records

**Input/Output:**
```
Input:  AgentProposal + Identity + PolicyContext
Output: ExecutionAuthorization | Denial
```

**Invariants:**
- No authorization without valid policy decision
- Authorization is bound to: agent identity, tool, resource, context
- Authorization expires (has TTL)
- Approval is enforced as a gate, not a recommendation
- Tenant boundaries are non-negotiable

---

### Layer 3: Execution Gate & Runtime (Enforcing)

**Responsibilities:**
- Validate authorization
- Enforce filesystem boundaries
- Enforce resource limits
- Invoke tools
- Return execution result

**Authority Boundary:**
- Runtime **enforces** (authorization + boundaries)
- Runtime **never** accepts context it didn't create
- Runtime **never** executes without valid authorization
- Runtime **never** mutates audit records
- Runtime **never** delegates boundary enforcement to tool

**Input/Output:**
```
Input:  ExecutionAuthorization + ExecutionCorrelation
Output: ExecutionResult | RuntimeError
```

**Invariants:**
- No tool invocation without valid authorization
- No tool invocation without valid execution context
- Filesystem boundaries are enforced before tool invocation
- Resource limits are enforced in-flight (can be aborted)
- There is **exactly one** entry point to protected tools: `executeTool()`
- No other API path leads to a protected tool

---

### Layer 4: Verification & Evidence (Proving)

**Responsibilities:**
- Verify execution correctness
- Correlate to original intent
- Generate verification evidence
- Produce verdict

**Authority Boundary:**
- Verification **proves** (or refutes)
- Verification **never** authorizes
- Verification **never** executes
- Verification **never** mutates resources
- Verification **never** mutates audit records

**Input/Output:**
```
Input:  ExecutionResult + AgentProposal
Output: VerificationReport (COMPLETED | VERIFIED | FAILED)
```

**Invariants:**
- Execution can complete but verification can still fail
- Verification failure is grounds for audit escalation
- Verification result is immutable (no retry rewrites history)

---

### Layer 5: Audit & Reconstruction (Recording)

**Responsibilities:**
- Record execution event
- Correlate all IDs in execution lifecycle
- Enable full reconstruction
- Preserve evidence chain

**Authority Boundary:**
- Audit **records** (facts only)
- Audit **never** authorizes
- Audit **never** executes
- Audit **never** mutates resources
- Audit records are **append-only**

**Input/Output:**
```
Input:  ExecutionResult + VerificationReport + Metadata
Output: AuditEvent (immutable record)
```

**Invariants:**
- Every protected execution produces exactly one audit event
- Audit event correlates all IDs in the execution chain
- Audit records cannot be modified or deleted
- Audit records can be reconstructed from correlation chain

---

### Layer 6: Production Gate (Releasing)

**Responsibilities:**
- Verify all required controls passed
- Verify no mandatory gates failed
- Release or block

**Authority Boundary:**
- Gate **releases or blocks**
- Gate **never** authorizes execution
- Gate **never** executes tools
- Gate **never** mutates resources

**Input/Output:**
```
Input:  SystemEvidence (all test results, audit records)
Output: ReleaseDecision (OPEN | BLOCKED)
```

**Invariants:**
- If any mandatory gate failed: `BLOCKED` (not "warning" or "continue anyway")
- If all mandatory gates passed: `OPEN`
- No release configuration can bypass this decision
- No agent intent can bypass this decision
- Bypass is blocked at the architectural level, not by policy

---

## System Invariants

These are laws. Not guidelines. Not "best practices." Laws.

### 1. Agent Reasoning is Never Authorization

An agent's confidence, certainty, or risk calculation **does not authorize** execution. Governance layer must independently authorize.

**Violation detection:** If a tool is invoked without a valid `ExecutionAuthorization` object in the call stack, system has failed.

### 2. Protected Tool Execution Requires Governance Authorization

There is no path to a protected tool that does not pass through authorization gate.

**Violation detection:** Code audit of all routes. Proof: try to invoke tool without going through `executeTool()` and observe: it fails.

### 3. Runtime Enforcement is Authoritative

If runtime says "DENIED", that overrides agent intent, governance recommendation, or any other signal.

**Violation detection:** Execution result that contradicts authorization decision means authorization was bypassed.

### 4. Authorization is Bound to Execution Context

An authorization token for `projectA` cannot authorize execution on `projectB`.  
An authorization for `tool_read_file` cannot authorize `tool_write_file`.

**Violation detection:** Mismatched context in audit record. Tenant cross-contamination in results.

### 5. Execution Cannot be Considered Successful Without Required Verification

Tool can complete, but verification can still determine: FAILED.

**Violation detection:** Execution recorded as SUCCESS without corresponding VerificationReport. Missing correlationId.

### 6. Audit Records Must Correlate to Execution Lifecycle

Every protected execution produces exactly one AuditEvent.  
AuditEvent contains all IDs in the chain.  
Missing ID means chain is broken.

**Violation detection:** Gap in correlation chain. Orphaned execution IDs. Untraced authorizations.

### 7. Protected Resources Cannot be Accessed Through Unauthorized Alternate Path

If resource is protected by `authorized_projects` check in one route, all other routes must have the same check.

**Violation detection:** Code audit. Resource access pattern analysis. Tenant cross-contamination in tests.

### 8. Mandatory Production Gates Cannot be Bypassed

Configuration, deployment workflow, agent intent, or any other signal cannot bypass mandatory gates.

**Violation detection:** Blocked release that goes live anyway. Audit record of release without gate approval.

### 9. Failed Mandatory Gates Block Production Release

If safety test fails, security test fails, or required approval is missing: release is BLOCKED.

Not "warning". Not "continue anyway". BLOCKED.

**Violation detection:** Build succeeds but release is attempted without all gates passing.

### 10. Every Protected Execution Must be Reconstructable

Given an `executionId`, the system can reconstruct:
- Who proposed it? (agentId)
- Who authorized it? (authorizationId)
- What policy decided? (governanceDecisionId)
- What tool was invoked? (toolCallId)
- Did it verify? (verificationId)
- What happened? (auditEventId)

**Violation detection:** Execution ID without corresponding audit entry. Broken correlation chain.

---

**This contract is the foundation. Everything else follows from it.**
