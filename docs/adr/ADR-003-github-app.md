# ADR-003: GitHub App over broad PATs

## Status

ACTIVE

## Decision

Integrate GitHub via a GitHub App with least-privilege read permissions and short-lived tokens.

## Initial permissions

Read: metadata, contents, statuses, issues, pull requests, actions, deployments.  
Write: **checks** only — required to publish `Atlas Truth` Check Runs after observe (TRUTH-10 · 1.6).  
Other write permissions remain deferred.
