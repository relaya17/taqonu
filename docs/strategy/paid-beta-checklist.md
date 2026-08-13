# G4 — Paid Beta checklist (human executable)

**Status:** READY pack · ops = human  
**Prerequisite:** G3 signals green OR founder override with ≥3 committed design partners.

## Offer (default)

| Item | Default |
|---|---|
| Price | Founder-set; start from G3 “fair” band |
| Term | 60–90 days Paid Beta |
| Scope | Linked workspaces · Truth · Sentinel · propose (no HIGH auto-apply) |
| Support | Shared Slack/email · weekly 30m office hours |
| Exit | Convert to annual / cancel · export Evidence artifacts |

## Pre-flight (engineering)

- [ ] G5 controls live (ownership · isolation audit · CI secret scan)
- [ ] Sentinel scan + verify path documented for partners
- [ ] Early Access agreement + DPA/NDA as needed ([`legal-media-comms.md`](./legal-media-comms.md))
- [ ] Billing path chosen (invoice / Stripe) — even if manual first month
- [ ] Success metrics defined: cycles run · HIGH caught · verify pass rate · time-to-evidence

## Partner onboarding

1. Kickoff: link workspace · run Truth cycle · run Sentinel  
2. Week 1: review top finding + one remediation propose→verify  
3. Week 2–4: continuous observe on their main branch / PR hooks if available  
4. Midpoint: willingness confirm + case-study permission ([`case-study-template.md`](./case-study-template.md))  
5. End: conversion offer + feedback into tracker

## Kill / continue criteria

| Continue | Kill / restructure |
|---|---|
| ≥70% partners renew or expand | <30% usage after week 2 |
| ≥1 publishable Evidence story | Repeated “no budget owner” |
| No isolation/security incident | Partner asks for offensive scanning |

## Do not

- Auto-apply HIGH/CRITICAL  
- Scan systems they do not own  
- Train models on customer code across tenants
