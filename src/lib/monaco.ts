import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/codicon/register.js';

// Load only the plain-text features used by the workbench.
import 'monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

const environment = self as typeof self & { MonacoEnvironment: monaco.Environment };
environment.MonacoEnvironment = { getWorker: () => new EditorWorker() };
export { monaco };
