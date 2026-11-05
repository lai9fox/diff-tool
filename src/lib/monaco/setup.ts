import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

export async function loadMonaco(locale: 'zh' | 'en') {
  self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') return new JsonWorker();
      if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
      if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
      if (['typescript', 'javascript'].includes(label)) return new TsWorker();
      return new EditorWorker();
    },
  };
  // The ESM distribution in 0.57 does not contain the advertised NLS bundles.
  void locale;
  const monaco = await import('monaco-editor');
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
  monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
  for (const defaults of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
    defaults.setDiagnosticsOptions({ validate: false });
  }
  for (const defaults of [monaco.html.htmlDefaults, monaco.html.handlebarDefaults, monaco.html.razorDefaults]) {
    defaults.setModeConfiguration({ ...defaults.modeConfiguration, diagnostics: false });
  }
  return monaco;
}
