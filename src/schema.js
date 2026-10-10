// Esquema do banco (idempotente: pode rodar a cada inicialização).
// Tabelas da v1 (viagens/despesas simples) são renomeadas para *_legado em db.js, sem perder dados.

const PERFIS = ['administrador', 'solicitante', 'aprovador', 'financeiro'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS funcionarios (
  id           SERIAL PRIMARY KEY,
  nome         TEXT NOT NULL,
  matricula    TEXT NOT NULL UNIQUE,
  funcao       TEXT NOT NULL DEFAULT '',
  setor        TEXT NOT NULL DEFAULT '',
  centro_custo TEXT NOT NULL DEFAULT '',
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  nome           TEXT NOT NULL,
  login          TEXT NOT NULL UNIQUE,
  senha_hash     TEXT NOT NULL,
  perfil         TEXT NOT NULL CHECK (perfil IN (${PERFIS.map((p) => `'${p}'`).join(', ')})),
  funcionario_id INTEGER REFERENCES funcionarios(id) ON DELETE SET NULL,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  token_versao   INTEGER NOT NULL DEFAULT 1,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS motivos_viagem (
  id    SERIAL PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS status_viagem (
  id     SERIAL PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome   TEXT NOT NULL,
  cor    TEXT NOT NULL DEFAULT '#64748b' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  ordem  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categorias_despesa (
  id    SERIAL PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS formas_pagamento (
  id               SERIAL PRIMARY KEY,
  nome             TEXT NOT NULL UNIQUE,
  uso_adiantamento BOOLEAN NOT NULL DEFAULT true,
  uso_reembolso    BOOLEAN NOT NULL DEFAULT true,
  ativo            BOOLEAN NOT NULL DEFAULT true
);

CREATE SEQUENCE IF NOT EXISTS viagens_numero_seq;

CREATE TABLE IF NOT EXISTS viagens (
  id                      SERIAL PRIMARY KEY,
  numero                  TEXT NOT NULL UNIQUE DEFAULT (
    'VG-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('viagens_numero_seq')::text, 4, '0')),
  funcionario_id          INTEGER NOT NULL REFERENCES funcionarios(id),
  solicitante_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  destino                 TEXT NOT NULL,
  motivo_id               INTEGER NOT NULL REFERENCES motivos_viagem(id),
  data_saida              DATE NOT NULL,
  data_retorno            DATE NOT NULL,
  descricao               TEXT NOT NULL DEFAULT '',
  valor_estimado          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_estimado >= 0),
  status_id               INTEGER NOT NULL REFERENCES status_viagem(id),
  aprovador_id            INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_em             TIMESTAMPTZ,
  decisao_justificativa   TEXT NOT NULL DEFAULT '',
  realizada_em            DATE,
  prestacao_situacao      TEXT NOT NULL DEFAULT 'pendente' CHECK (prestacao_situacao IN ('pendente','enviada','aprovada','devolvida')),
  prestacao_enviada_em    TIMESTAMPTZ,
  prestacao_analisada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  prestacao_analisada_em  TIMESTAMPTZ,
  prestacao_obs           TEXT NOT NULL DEFAULT '',
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_retorno >= data_saida)
);
CREATE INDEX IF NOT EXISTS viagens_funcionario_idx ON viagens (funcionario_id);
CREATE INDEX IF NOT EXISTS viagens_saida_idx ON viagens (data_saida);

CREATE TABLE IF NOT EXISTS adiantamentos (
  id                 SERIAL PRIMARY KEY,
  viagem_id          INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  valor_solicitado   NUMERIC(12,2) NOT NULL CHECK (valor_solicitado > 0),
  valor_aprovado     NUMERIC(12,2) CHECK (valor_aprovado >= 0),
  valor_pago         NUMERIC(12,2) CHECK (valor_pago >= 0),
  forma_pagamento_id INTEGER REFERENCES formas_pagamento(id),
  data_pagamento     DATE,
  situacao           TEXT NOT NULL DEFAULT 'solicitado' CHECK (situacao IN ('solicitado','aprovado','pago','rejeitado','cancelado')),
  observacao         TEXT NOT NULL DEFAULT '',
  solicitado_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  pago_por           INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adiantamentos_viagem_idx ON adiantamentos (viagem_id);

CREATE TABLE IF NOT EXISTS despesas (
  id              SERIAL PRIMARY KEY,
  viagem_id       INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  categoria_id    INTEGER NOT NULL REFERENCES categorias_despesa(id),
  descricao       TEXT NOT NULL DEFAULT '',
  valor           NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  data            DATE NOT NULL,
  situacao        TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','aprovada','rejeitada')),
  motivo_rejeicao TEXT NOT NULL DEFAULT '',
  analisada_por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  analisada_em    TIMESTAMPTZ,
  lancada_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS despesas_viagem_v2_idx ON despesas (viagem_id, data);

CREATE TABLE IF NOT EXISTS reembolsos (
  id                 SERIAL PRIMARY KEY,
  viagem_id          INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  valor_solicitado   NUMERIC(12,2) NOT NULL CHECK (valor_solicitado > 0),
  valor_aprovado     NUMERIC(12,2) CHECK (valor_aprovado >= 0),
  valor_pago         NUMERIC(12,2) CHECK (valor_pago >= 0),
  motivo             TEXT NOT NULL DEFAULT '',
  forma_pagamento_id INTEGER REFERENCES formas_pagamento(id),
  data_pagamento     DATE,
  situacao           TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','aprovado','reembolsado','rejeitado')),
  observacao         TEXT NOT NULL DEFAULT '',
  solicitado_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  pago_por           INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reembolsos_viagem_idx ON reembolsos (viagem_id);

CREATE TABLE IF NOT EXISTS anexos (
  id           SERIAL PRIMARY KEY,
  viagem_id    INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  entidade     TEXT NOT NULL CHECK (entidade IN ('despesa','adiantamento','reembolso')),
  entidade_id  INTEGER NOT NULL,
  nome_arquivo TEXT NOT NULL,
  tipo_mime    TEXT NOT NULL,
  tamanho      INTEGER NOT NULL,
  conteudo     BYTEA NOT NULL,
  enviado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anexos_entidade_idx ON anexos (entidade, entidade_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id           BIGSERIAL PRIMARY KEY,
  usuario_id   INTEGER,
  usuario_nome TEXT NOT NULL DEFAULT '',
  acao         TEXT NOT NULL,
  entidade     TEXT NOT NULL,
  entidade_id  INTEGER,
  viagem_id    INTEGER,
  detalhes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_viagem_idx ON auditoria (viagem_id, criado_em);
CREATE INDEX IF NOT EXISTS auditoria_criado_idx ON auditoria (criado_em DESC);

CREATE TABLE IF NOT EXISTS documentos_re (
  id                      SERIAL PRIMARY KEY,
  codigo                  TEXT NOT NULL UNIQUE,
  titulo                  TEXT NOT NULL,
  sistema                 TEXT NOT NULL DEFAULT 'Sistema de Gestão Integrada',
  tipo_registro           TEXT NOT NULL DEFAULT 'Registro',
  versao                  TEXT NOT NULL,
  data_versao             DATE NOT NULL,
  periodicidade           TEXT NOT NULL DEFAULT '',
  empresa                 TEXT NOT NULL DEFAULT '',
  cidade                  TEXT NOT NULL DEFAULT '',
  responsavel_nome        TEXT NOT NULL DEFAULT '',
  responsavel_cargo       TEXT NOT NULL DEFAULT '',
  responsavel_matricula   TEXT NOT NULL DEFAULT '',
  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS autorizacoes_numero_seq;

CREATE TABLE IF NOT EXISTS autorizacoes_desconto (
  id                 SERIAL PRIMARY KEY,
  numero             TEXT NOT NULL UNIQUE DEFAULT (
    'AD-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('autorizacoes_numero_seq')::text, 4, '0')),
  funcionario_id     INTEGER NOT NULL REFERENCES funcionarios(id),
  func_nome          TEXT NOT NULL,
  func_matricula     TEXT NOT NULL,
  func_funcao        TEXT NOT NULL DEFAULT '',
  func_setor         TEXT NOT NULL DEFAULT '',
  viagem_id          INTEGER REFERENCES viagens(id) ON DELETE SET NULL,
  valor              NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  parcelas           INTEGER NOT NULL CHECK (parcelas BETWEEN 1 AND 36),
  data_inicio        DATE NOT NULL,
  data_documento     DATE NOT NULL,
  referente          TEXT NOT NULL,
  motivos            TEXT[] NOT NULL,
  situacao           TEXT NOT NULL DEFAULT 'emitida' CHECK (situacao IN ('emitida','assinada','concluida','cancelada')),
  assinada_em        DATE,
  concluida_em       DATE,
  motivo_cancelamento TEXT NOT NULL DEFAULT '',
  documento          JSONB NOT NULL,
  criado_por         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS autorizacoes_viagem_idx ON autorizacoes_desconto (viagem_id);
CREATE INDEX IF NOT EXISTS autorizacoes_func_idx ON autorizacoes_desconto (funcionario_id);

-- Comprovantes também podem pertencer a uma autorização de desconto (que pode não ter viagem)
ALTER TABLE anexos ALTER COLUMN viagem_id DROP NOT NULL;
ALTER TABLE anexos DROP CONSTRAINT IF EXISTS anexos_entidade_check;
ALTER TABLE anexos ADD CONSTRAINT anexos_entidade_check CHECK (entidade IN ('despesa','adiantamento','reembolso','autorizacao'));
`;

const SEEDS = `
INSERT INTO motivos_viagem (nome) VALUES
  ('Manutenção'), ('Viagem programada'), ('Reunião'), ('Treinamento'), ('Outros')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO status_viagem (codigo, nome, cor, ordem) VALUES
  ('solicitada',           'Solicitada',           '#64748b', 1),
  ('aguardando_aprovacao', 'Aguardando aprovação', '#d97706', 2),
  ('aprovada',             'Aprovada',             '#2563eb', 3),
  ('reprovada',            'Reprovada',            '#dc2626', 4),
  ('realizada',            'Realizada',            '#16a34a', 5),
  ('nao_realizada',        'Não realizada',        '#7c3aed', 6),
  ('cancelada',            'Cancelada',            '#475569', 7)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO categorias_despesa (nome) VALUES
  ('Alimentação'), ('Combustível'), ('Hospedagem'), ('Pedágio'), ('Manutenção'), ('Transporte'), ('Outros')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO formas_pagamento (nome, uso_adiantamento, uso_reembolso) VALUES
  ('Dinheiro',        true,  false),
  ('Depósito em conta', true, true),
  ('Transferência',   true,  true),
  ('Outros',          false, true)
ON CONFLICT (nome) DO NOTHING;

-- Formulário padrão RE. 0150.09 (Autorização de Desconto), versão 02 de 03/02/2023.
-- Os dados da pessoa responsável (RH) são preenchidos pelo administrador em Cadastros → Formulários (RE).
INSERT INTO documentos_re (codigo, titulo, versao, data_versao, periodicidade, empresa, cidade, responsavel_cargo)
VALUES ('RE. 0150.09', 'AUTORIZAÇÃO DE DESCONTO', '02', '2023-02-03', 'Sempre que houver desconto',
        'CRV INDUSTRIAL LTDA', 'Capinópolis-MG', 'COORDENADORA DE RH')
ON CONFLICT (codigo) DO NOTHING;
`;

module.exports = { SCHEMA, SEEDS, PERFIS };
