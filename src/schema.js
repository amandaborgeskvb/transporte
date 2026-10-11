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

-- Importação de funcionários (planilhas do ERP/RH): colunas de origem e histórico das importações
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS origem_codigo  TEXT;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS empresa_codigo TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS empregador     TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS importado_em   TIMESTAMPTZ;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_origem_idx ON funcionarios (origem_codigo) WHERE origem_codigo IS NOT NULL;

-- Situação do funcionário (Ativo / Afastado / Demitido), vinda dos arquivos da importação ou editada à mão.
-- "ativo" continua valendo como "pode receber novas viagens" e é sempre derivado da situação (ativo = situação Ativo).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'funcionarios' AND column_name = 'situacao') THEN
    ALTER TABLE funcionarios ADD COLUMN situacao TEXT NOT NULL DEFAULT 'Ativo';
    UPDATE funcionarios SET situacao = 'Demitido' WHERE NOT ativo;
  END IF;
END $$;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_admissao DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_situacao DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS tipo_contrato TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS local_trabalho TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS funcionarios_situacao_idx ON funcionarios (situacao);

-- Fim das etapas de aprovação: o que estava aguardando aprovação passa a seguir direto (idempotente)
UPDATE viagens SET status_id = (SELECT id FROM status_viagem WHERE codigo = 'aprovada')
  WHERE status_id IN (SELECT id FROM status_viagem WHERE codigo IN ('solicitada', 'aguardando_aprovacao', 'reprovada'))
    AND EXISTS (SELECT 1 FROM status_viagem WHERE codigo = 'aprovada');
DELETE FROM status_viagem WHERE codigo IN ('solicitada', 'aguardando_aprovacao', 'reprovada')
  AND NOT EXISTS (SELECT 1 FROM viagens v WHERE v.status_id = status_viagem.id);
UPDATE status_viagem SET nome = 'Programada' WHERE codigo = 'aprovada' AND nome = 'Aprovada';
UPDATE adiantamentos SET situacao = 'aprovado', valor_aprovado = COALESCE(valor_aprovado, valor_solicitado) WHERE situacao = 'solicitado';
ALTER TABLE reembolsos DROP CONSTRAINT IF EXISTS reembolsos_situacao_check;
ALTER TABLE reembolsos ADD CONSTRAINT reembolsos_situacao_check CHECK (situacao IN ('pendente','aprovado','reembolsado','rejeitado','cancelado'));
UPDATE reembolsos SET situacao = 'aprovado', valor_aprovado = COALESCE(valor_aprovado, valor_solicitado) WHERE situacao = 'pendente';

-- Prestação de contas sem etapa de análise: enviar encerra (idempotente)
UPDATE despesas SET situacao = 'aprovada', analisada_em = now()
  WHERE situacao = 'pendente' AND viagem_id IN (SELECT id FROM viagens WHERE prestacao_situacao = 'enviada');
UPDATE viagens SET prestacao_situacao = 'aprovada', prestacao_analisada_em = COALESCE(prestacao_analisada_em, now()) WHERE prestacao_situacao = 'enviada';

-- ===== Gratificação rescisória =====
-- Parâmetros: base de dias, janela de média, cortes e quais componentes sofrem desconto (linha única)
CREATE TABLE IF NOT EXISTS grat_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  base_dias         INTEGER NOT NULL DEFAULT 25 CHECK (base_dias BETWEEN 1 AND 31),
  meses_media       INTEGER NOT NULL DEFAULT 3 CHECK (meses_media BETWEEN 1 AND 12),
  dia_corte         INTEGER NOT NULL DEFAULT 16 CHECK (dia_corte BETWEEN 1 AND 28),
  descontar_bpp     BOOLEAN NOT NULL DEFAULT false,
  descontar_zelo    BOOLEAN NOT NULL DEFAULT false,
  descontar_prod    BOOLEAN NOT NULL DEFAULT true,
  palavras_operador TEXT NOT NULL DEFAULT 'MOTORISTA, OPERADOR'
);

-- Critério de pagamento por tipo de rescisão
CREATE TABLE IF NOT EXISTS grat_criterios (
  id           SERIAL PRIMARY KEY,
  tipo_rescisao TEXT NOT NULL UNIQUE,
  pagar_bpp    BOOLEAN NOT NULL DEFAULT true,
  pagar_zelo   BOOLEAN NOT NULL DEFAULT true,
  pagar_prod   BOOLEAN NOT NULL DEFAULT true,
  ativo        BOOLEAN NOT NULL DEFAULT true
);

-- Descontos por tipo de ocorrência, em dois grupos de funções: auxiliares e demais / operadores e motoristas
CREATE TABLE IF NOT EXISTS grat_penalidades (
  id           SERIAL PRIMARY KEY,
  grupo        TEXT NOT NULL CHECK (grupo IN ('auxiliar','operador')),
  abrev        TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  percentual   NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (percentual BETWEEN 0 AND 1),
  desconta_dia BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (grupo, abrev)
);

-- Valores mensais pagos (arquivo: matrícula, BPP, Zelo/Equip., Produtividade, mês)
CREATE TABLE IF NOT EXISTS grat_valores (
  id             SERIAL PRIMARY KEY,
  matricula      TEXT NOT NULL,
  mes            DATE NOT NULL,
  bpp            NUMERIC(12,2) NOT NULL DEFAULT 0,
  zelo           NUMERIC(12,2) NOT NULL DEFAULT 0,
  prod           NUMERIC(12,2) NOT NULL DEFAULT 0,
  origem         TEXT NOT NULL DEFAULT '',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (matricula, mes)
);

-- Ocorrências (notificações): penalidades, faltas, atestados…
CREATE TABLE IF NOT EXISTS grat_ocorrencias (
  id             SERIAL PRIMARY KEY,
  data           DATE NOT NULL,
  matricula      TEXT NOT NULL,
  abrev          TEXT NOT NULL,
  gestor         TEXT NOT NULL DEFAULT '',
  observacao     TEXT NOT NULL DEFAULT '',
  criado_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grat_ocorrencias_mat_idx ON grat_ocorrencias (matricula, data);

-- Apuração: um registro por rescisão
CREATE TABLE IF NOT EXISTS grat_rescisoes (
  id               SERIAL PRIMARY KEY,
  funcionario_id   INTEGER NOT NULL REFERENCES funcionarios(id),
  criterio_id      INTEGER NOT NULL REFERENCES grat_criterios(id),
  dt_rescisao      DATE NOT NULL,
  dias_trabalhados INTEGER NOT NULL CHECK (dias_trabalhados BETWEEN 0 AND 62),
  grupo            TEXT CHECK (grupo IS NULL OR grupo IN ('auxiliar','operador')),
  observacao       TEXT NOT NULL DEFAULT '',
  situacao         TEXT NOT NULL DEFAULT 'apurada' CHECK (situacao IN ('apurada','paga')),
  paga_em          DATE,
  criado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grat_rescisoes_func_idx ON grat_rescisoes (funcionario_id, dt_rescisao);

-- Ajustes para seguir as fórmulas da planilha (idempotentes):
-- valores vazios não entram na média; dias descontados por ocorrência; escala de folga na apuração
ALTER TABLE grat_valores ALTER COLUMN bpp DROP NOT NULL, ALTER COLUMN bpp DROP DEFAULT,
  ALTER COLUMN zelo DROP NOT NULL, ALTER COLUMN zelo DROP DEFAULT,
  ALTER COLUMN prod DROP NOT NULL, ALTER COLUMN prod DROP DEFAULT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'grat_penalidades' AND column_name = 'dias_desconto') THEN
    ALTER TABLE grat_penalidades ADD COLUMN dias_desconto INTEGER NOT NULL DEFAULT 1 CHECK (dias_desconto BETWEEN 0 AND 5);
    UPDATE grat_penalidades SET dias_desconto = CASE WHEN abrev = 'ADV' OR abrev = 'DISP_MEC' THEN 0 WHEN abrev = 'SS' THEN 2 ELSE 1 END;
  END IF;
END $$;
ALTER TABLE grat_rescisoes ADD COLUMN IF NOT EXISTS escala TEXT;
ALTER TABLE grat_rescisoes ALTER COLUMN dias_trabalhados DROP NOT NULL;
-- Padrões da planilha nas instalações que ainda não mexeram nos parâmetros: desconto só na produtividade;
-- "sem justa causa" paga o Zelo (a fórmula só zera na justa causa; o texto do critério fala apenas do BPP)
UPDATE grat_config SET descontar_bpp = false, descontar_zelo = false
  WHERE descontar_bpp AND descontar_zelo AND descontar_prod AND NOT EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'grat_config');
UPDATE grat_criterios SET pagar_zelo = true
  WHERE tipo_rescisao = 'DEMISSÃO S/ J. CAUSA' AND NOT pagar_zelo AND NOT EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'grat_criterio');

CREATE TABLE IF NOT EXISTS importacoes (
  id           SERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL,
  arquivo      TEXT NOT NULL,
  usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome TEXT NOT NULL DEFAULT '',
  mapeamento   JSONB NOT NULL DEFAULT '{}'::jsonb,
  opcoes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  resumo       JSONB NOT NULL DEFAULT '{}'::jsonb,
  relatorio    JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comprovantes também podem pertencer a uma autorização de desconto (que pode não ter viagem)
ALTER TABLE anexos ALTER COLUMN viagem_id DROP NOT NULL;
ALTER TABLE anexos DROP CONSTRAINT IF EXISTS anexos_entidade_check;
ALTER TABLE anexos ADD CONSTRAINT anexos_entidade_check CHECK (entidade IN ('despesa','adiantamento','reembolso','autorizacao'));
`;

const SEEDS = `
INSERT INTO motivos_viagem (nome) VALUES
  ('Manutenção'), ('Viagem programada'), ('Reunião'), ('Treinamento'), ('Outros')
ON CONFLICT (nome) DO NOTHING;

-- Sem etapa de aprovação: a viagem nasce "Programada" (código interno "aprovada", mantido por compatibilidade)
INSERT INTO status_viagem (codigo, nome, cor, ordem) VALUES
  ('aprovada',             'Programada',           '#2563eb', 3),
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
-- Gratificação rescisória: parâmetros iniciais (editáveis em Gratificação rescisória → Parâmetros)
INSERT INTO grat_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO grat_criterios (tipo_rescisao, pagar_bpp, pagar_zelo, pagar_prod) VALUES
  ('PEDIDO DE DEMISSÃO',             true,  true,  true),
  ('DEMISSÃO S/ J. CAUSA',           false, true,  true),
  ('TERMINO CONTRATO - FIM DE SAFRA', true,  true,  true),
  ('FALECIMENTO',                    true,  true,  true),
  ('DEMISSÃO C/ J. CAUSA',           false, false, false),
  ('COMUM ACORDO',                   true,  true,  true),
  ('TERMINO CONTRATO',               true,  true,  true)
ON CONFLICT (tipo_rescisao) DO NOTHING;

INSERT INTO grat_penalidades (grupo, abrev, descricao, percentual, desconta_dia, dias_desconto) VALUES
  ('auxiliar', 'NC',  'NÃO CONFORMIDADE',        0.04, true,  1),
  ('auxiliar', 'ADV', 'ADVERTÊNCIA',             0.50, false, 0),
  ('auxiliar', 'SS',  'SUSPENSÃO',               1.00, true,  2),
  ('auxiliar', 'ST',  'SEGURANÇA TRABALHO',      0.50, true,  1),
  ('auxiliar', 'FJ',  'FALTA JUSTIFICADA',       0.04, true,  1),
  ('auxiliar', 'FF',  'FALTA INJUSTIFICADA',     0.50, true,  1),
  ('auxiliar', 'L',   'ATESTADOS E LICENÇAS',    0.04, true,  1),
  ('auxiliar', 'FÉ',  'FÉRIAS',                  0,    true,  1),
  ('auxiliar', 'ACT', 'ACIDENTE NO TRABALHO',    0,    true,  1),
  ('operador', 'NC',  'NÃO CONFORMIDADE',        0.04, true,  1),
  ('operador', 'ADV', 'ADVERTÊNCIA',             0.05, false, 0),
  ('operador', 'SS',  'SUSPENSÃO',               0.10, true,  2),
  ('operador', 'FJ',  'FALTA JUSTIFICADA',       0.04, true,  1),
  ('operador', 'FF',  'FALTA INJUSTIFICADA',     0.05, true,  1),
  ('operador', 'L',   'ATESTADOS E LICENÇAS',    0.04, true,  1),
  ('operador', 'DISP_MEC', 'DISPONIBILIDADE MECÂNICA (< 80%)', 0.10, false, 0),
  ('operador', 'FÉ',  'FÉRIAS',                  0,    true,  1),
  ('operador', 'ACT', 'ACIDENTE NO TRABALHO',    0,    true,  1)
ON CONFLICT (grupo, abrev) DO NOTHING;
`;

module.exports = { SCHEMA, SEEDS, PERFIS };
