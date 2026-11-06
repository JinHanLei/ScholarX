import { defaultUrlTransform } from 'react-markdown';

// Map the selected project's absolute artifact paths to the guarded local API.
export function researchLink(url, project) {
  const root = project?.root_path?.replaceAll('\\', '/').replace(/\/$/, '');
  const normalized = url.replaceAll('\\', '/');
  if (root && normalized.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    const relative = normalized.slice(root.length + 1).replace(/:\d+$/, '');
    if (relative.split('/').some((part) => part === '..' || part === '.')) return '';
    return `/api/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(relative)}`;
  }
  // Keep react-markdown's protocol protection for everything else.
  return defaultUrlTransform(url);
}
