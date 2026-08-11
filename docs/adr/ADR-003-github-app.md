# ADR-003: GitHub App over broad PATs

## Status

ACTIVE

## Decision

Integrate GitHub via a GitHub App with least-privilege read permissions and short-lived tokens.

## Initial permissions

Read: metadata, contents, statuses, issues, pull requests, actions, deployments.  
Write permissions deferred until an explicit feature requires them.
