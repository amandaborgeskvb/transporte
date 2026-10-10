// Acesso à API e cache dos cadastros (listas usadas nos formulários e filtros).

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

async function tratar(r, url) {
  if (r.status === 401 && !['/login', '/logout'].includes(url)) {
    window.dispatchEvent(new CustomEvent('sessao-expirada'));
    throw new ErroApi('Sua sessão expirou. Entre novamente.', 401);
  }
  if (r.status === 204) return null;
  const tipo = r.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new ErroApi(dados.erro || 'Erro inesperado. Tente novamente.', r.status);
  return dados;
}

export async function api(metodo, url, corpo) {
  const r = await fetch('/api' + url, {
    method: metodo,
    headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  return tratar(r, url);
}

export const get = (url) => api('GET', url);
export const post = (url, corpo = {}) => api('POST', url, corpo);
export const put = (url, corpo) => api('PUT', url, corpo);
export const del = (url) => api('DELETE', url);

export const TIPOS_ANEXO = ['application/pdf', 'image/png', 'image/jpeg'];
export const MAX_ANEXO = 5 * 1024 * 1024;

export async function enviarAnexo(entidade, id, arquivo) {
  if (!TIPOS_ANEXO.includes(arquivo.type)) throw new ErroApi('Formato não aceito. Use PDF, JPG ou PNG.', 400);
  if (arquivo.size > MAX_ANEXO) throw new ErroApi('O arquivo excede 5 MB.', 400);
  const q = new URLSearchParams({ entidade, id, nome: arquivo.name });
  const r = await fetch(`/api/anexos?${q}`, { method: 'POST', headers: { 'Content-Type': arquivo.type }, body: arquivo });
  return tratar(r, '/anexos');
}

// Envia um arquivo (bytes) para o importador; o servidor reconhece o formato pelo conteúdo
export async function enviarArquivo(url, arquivo, params = {}) {
  const q = new URLSearchParams({ ...params, nome: arquivo.name });
  const r = await fetch(`/api${url}?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: arquivo });
  return tratar(r, url);
}

// ---- Cadastros em cache ----
let cache = null;
export async function cadastros(forcar = false) {
  if (cache && !forcar) return cache;
  const [funcionarios, motivos, status, categorias, formas] = await Promise.all(
    ['funcionarios', 'motivos', 'status', 'categorias', 'formas'].map((c) => get(`/cadastros/${c}`)),
  );
  cache = { funcionarios, motivos, status, categorias, formas };
  return cache;
}
export const limparCadastros = () => { cache = null; };
