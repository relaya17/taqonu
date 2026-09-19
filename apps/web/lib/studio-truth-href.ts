/**
 * Finding → Truth navigation. next-intl Link must receive pathname + query
 * as an object; a string `/truth?project=` drops the search params when
 * used as MUI Button href.
 */
export function studioTruthHref(projectId: string): {
  pathname: "/truth";
  query: { project: string };
} {
  return {
    pathname: "/truth",
    query: { project: projectId },
  };
}
