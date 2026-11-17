// Where the site's content lives, so the live site can hand writing off to GitHub's web editor.
export const REPO = 'sunny-dubey/reading-room';
export const BRANCH = 'main';
export const GH = `https://github.com/${REPO}`;
export const ghNewNote = `${GH}/new/${BRANCH}/src/content/notes`;
export const ghEditFile = (path: string) => `${GH}/edit/${BRANCH}/${path}`;
