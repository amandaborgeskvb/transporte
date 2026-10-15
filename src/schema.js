// Esquema do banco (idempotente: pode rodar a cada inicialização).
// Tabelas da v1 (viagens/despesas simples) são renomeadas para *_legado em db.js, sem perder dados.

// treinamento, gratificacao, contratacao e onibus: perfis de um módulo só (veem apenas o próprio módulo e o resumo dele no Início)
const PERFIS = ['administrador', 'solicitante', 'aprovador', 'financeiro', 'treinamento', 'gratificacao', 'contratacao', 'onibus', 'operacional'];

// Numera, na ordem de lançamento, os treinamentos ainda sem Nº DOC (ano da data do crachá ou, sem ela, do início da vigência)
const SQL_NUMERAR_TREINO = `
WITH x AS (
  SELECT id, extract(year FROM COALESCE(data_cracha, vigencia_de))::int AS ano FROM trein_registros WHERE doc_numero IS NULL
), y AS (SELECT id, ano, row_number() OVER (PARTITION BY ano ORDER BY id) AS rn FROM x)
UPDATE trein_registros r SET doc_ano = y.ano, doc_numero = COALESCE((SELECT max(t.doc_numero) FROM trein_registros t WHERE t.doc_ano = y.ano), 0) + y.rn
FROM y WHERE r.id = y.id`;

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
-- Perfis novos (atualiza a lista permitida em bancos já existentes)
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_perfil_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_check CHECK (perfil IN (${PERFIS.map((p) => `'${p}'`).join(', ')}));

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
ALTER TABLE grat_ocorrencias ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT '';
-- Desconto das ocorrências por grupo de função: auxiliares e demais → BPP; operadores e motoristas → produtividade
ALTER TABLE grat_config ADD COLUMN IF NOT EXISTS desconto_auxiliar TEXT NOT NULL DEFAULT 'bpp';
ALTER TABLE grat_config ADD COLUMN IF NOT EXISTS desconto_operador TEXT NOT NULL DEFAULT 'prod';
ALTER TABLE grat_config DROP CONSTRAINT IF EXISTS grat_config_desconto_check;
-- O Zelo/Equipamento deixou de ser pago: opções antigas que o usavam voltam ao equivalente sem ele
UPDATE grat_config SET desconto_auxiliar = CASE desconto_auxiliar WHEN 'zelo' THEN 'bpp' WHEN 'todos' THEN 'bpp_prod' ELSE desconto_auxiliar END,
                       desconto_operador = CASE desconto_operador WHEN 'zelo' THEN 'prod' WHEN 'todos' THEN 'bpp_prod' ELSE desconto_operador END
  WHERE desconto_auxiliar IN ('zelo','todos') OR desconto_operador IN ('zelo','todos');
ALTER TABLE grat_config ADD CONSTRAINT grat_config_desconto_check
  CHECK (desconto_auxiliar IN ('bpp','prod','bpp_prod','nenhum') AND desconto_operador IN ('bpp','prod','bpp_prod','nenhum'));
-- Se o componente do desconto não for pago na rescisão, o desconto vai para o outro componente pago
ALTER TABLE grat_config ADD COLUMN IF NOT EXISTS desconto_redireciona BOOLEAN NOT NULL DEFAULT true;
-- O Cartão Gold passou a ser um componente com valor próprio (Gratificação Funções): sai a opção "BPP no Cartão Gold"
ALTER TABLE grat_config DROP COLUMN IF EXISTS bpp_cartao;
-- Classificação manual das funções (Parâmetros → Motoristas e operadores); chave = nome da função sem acentos
CREATE TABLE IF NOT EXISTS grat_funcoes (
  funcao        TEXT PRIMARY KEY,
  grupo         TEXT NOT NULL CHECK (grupo IN ('auxiliar','operador')),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Menu Gratificação Funções: por função, grupo, onde as ocorrências descontam (BPP/produtividade) e os valores de BPP,
-- Cartão Gold e Produtividade usados no cálculo. Vazio = padrão do grupo / automático / sem valor.
ALTER TABLE grat_funcoes ALTER COLUMN grupo DROP NOT NULL;
ALTER TABLE grat_funcoes ADD COLUMN IF NOT EXISTS desconto TEXT CHECK (desconto IS NULL OR desconto IN ('bpp','prod'));
ALTER TABLE grat_funcoes DROP COLUMN IF EXISTS bpp_destino;
ALTER TABLE grat_funcoes ADD COLUMN IF NOT EXISTS cadastrada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE grat_funcoes ADD COLUMN IF NOT EXISTS valor_bpp  NUMERIC(12,2) CHECK (valor_bpp IS NULL OR valor_bpp >= 0);
ALTER TABLE grat_funcoes ADD COLUMN IF NOT EXISTS valor_gold NUMERIC(12,2) CHECK (valor_gold IS NULL OR valor_gold >= 0);
ALTER TABLE grat_funcoes ADD COLUMN IF NOT EXISTS valor_prod NUMERIC(12,2) CHECK (valor_prod IS NULL OR valor_prod >= 0);
ALTER TABLE grat_funcoes ADD COLUMN IF NOT EXISTS codigo TEXT NOT NULL DEFAULT '';
-- Critério por tipo de rescisão: paga o Cartão Gold? (na criação, igual ao que já estava para a produtividade)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'grat_criterios' AND column_name = 'pagar_gold') THEN
    ALTER TABLE grat_criterios ADD COLUMN pagar_gold BOOLEAN NOT NULL DEFAULT true;
    UPDATE grat_criterios SET pagar_gold = pagar_prod;
  END IF;
END $$;

-- Assinaturas do demonstrativo de pagamento (modelo da aba Diversos)
CREATE TABLE IF NOT EXISTS grat_signatarios (
  id     SERIAL PRIMARY KEY,
  nome   TEXT NOT NULL DEFAULT '',
  cargo  TEXT NOT NULL,
  ordem  INTEGER NOT NULL DEFAULT 1,
  ativo  BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE grat_rescisoes ALTER COLUMN dias_trabalhados DROP NOT NULL;
-- Turno do funcionário (A, B ou C), ao lado da letra de folga como na aba BD; informativo (não entra no cálculo)
ALTER TABLE grat_rescisoes ADD COLUMN IF NOT EXISTS turno TEXT;
ALTER TABLE grat_rescisoes DROP CONSTRAINT IF EXISTS grat_rescisoes_turno_check;
ALTER TABLE grat_rescisoes ADD CONSTRAINT grat_rescisoes_turno_check CHECK (turno IS NULL OR turno IN ('A','B','C'));
-- Padrões da planilha nas instalações que ainda não mexeram nos parâmetros: desconto só na produtividade;
-- "sem justa causa" paga o Zelo (a fórmula só zera na justa causa; o texto do critério fala apenas do BPP)
UPDATE grat_config SET descontar_bpp = false, descontar_zelo = false
  WHERE descontar_bpp AND descontar_zelo AND descontar_prod AND NOT EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'grat_config');
UPDATE grat_criterios SET pagar_zelo = true
  WHERE tipo_rescisao = 'DEMISSÃO S/ J. CAUSA' AND NOT pagar_zelo AND NOT EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'grat_criterio');

-- ===== Contratação: Ficha de Informe de Contratação (formulário RE.0150.03) =====
-- Parâmetros (abas da planilha de controle): funções e salários, departamentos e gerências/gestores
CREATE TABLE IF NOT EXISTS contr_funcoes (
  id               SERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  descricao        TEXT NOT NULL,
  salario          NUMERIC(12,2) CHECK (salario IS NULL OR salario >= 0),
  tipo_salario     TEXT NOT NULL DEFAULT '',
  cbo              TEXT NOT NULL DEFAULT '',
  cnh_obrigatoria  BOOLEAN NOT NULL DEFAULT false,
  bloqueada        BOOLEAN NOT NULL DEFAULT false,
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contr_departamentos (
  id         SERIAL PRIMARY KEY,
  codigo     TEXT NOT NULL UNIQUE,
  descricao  TEXT NOT NULL,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  grau       INTEGER
);
CREATE TABLE IF NOT EXISTS contr_gerencias (
  id      SERIAL PRIMARY KEY,
  codigo  INTEGER NOT NULL UNIQUE,
  nome    TEXT NOT NULL,
  ativo   BOOLEAN NOT NULL DEFAULT true
);
-- Fichas (base da mala direta): o nome, a função e o departamento são digitados; salário, descrição do departamento
-- e horário são puxados dos parâmetros e gravados na ficha (a ficha impressa não muda se o parâmetro mudar depois)
CREATE TABLE IF NOT EXISTS contr_fichas (
  id                      SERIAL PRIMARY KEY,
  data                    DATE NOT NULL,
  nome                    TEXT NOT NULL,
  funcao_id               INTEGER REFERENCES contr_funcoes(id) ON DELETE SET NULL,
  funcao                  TEXT NOT NULL DEFAULT '',
  depto_codigo            TEXT NOT NULL DEFAULT '',
  depto_descricao         TEXT NOT NULL DEFAULT '',
  destino                 TEXT NOT NULL DEFAULT '',
  setor                   TEXT NOT NULL DEFAULT '',
  jornada                 TEXT NOT NULL DEFAULT '',
  horario                 TEXT NOT NULL DEFAULT '',
  turno                   TEXT CHECK (turno IS NULL OR turno IN ('adm','matutino','vespertino','noturno')),
  contrato_safra          BOOLEAN NOT NULL DEFAULT false,
  contrato_experiencia    BOOLEAN NOT NULL DEFAULT false,
  contrato_determinado    BOOLEAN NOT NULL DEFAULT false,
  contrato_indeterminado  BOOLEAN NOT NULL DEFAULT false,
  salario                 NUMERIC(12,2),
  gerencia_id             INTEGER REFERENCES contr_gerencias(id) ON DELETE SET NULL,
  gestor                  TEXT NOT NULL DEFAULT '',
  telefone                TEXT NOT NULL DEFAULT '',
  celular1                TEXT NOT NULL DEFAULT '',
  celular2                TEXT NOT NULL DEFAULT '',
  email                   TEXT NOT NULL DEFAULT '',
  cidade                  TEXT NOT NULL DEFAULT '',
  observacao              TEXT NOT NULL DEFAULT '',
  origem                  TEXT NOT NULL DEFAULT 'digitada',
  criado_por              INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contr_fichas_data_idx ON contr_fichas (data DESC, id DESC);
CREATE INDEX IF NOT EXISTS contr_fichas_depto_funcao_idx ON contr_fichas (depto_codigo, funcao_id, data DESC);

-- ===== Treinamento prático operacional (planilha RE.1005.04) e C.I. do crachá de treinamento (RE. 0940.02D) =====
-- Dados do funcionário que o cadastro do ERP não traz (CNH, categoria, validade, celular, cidade e escala) e base de reserva
-- para quem não está no cadastro; carregados pela aba APFO/ESCALA da planilha
CREATE TABLE IF NOT EXISTS trein_base (
  matricula      TEXT PRIMARY KEY,
  nome           TEXT NOT NULL DEFAULT '',
  funcao         TEXT NOT NULL DEFAULT '',
  setor          TEXT NOT NULL DEFAULT '',
  data_admissao  DATE,
  situacao       TEXT NOT NULL DEFAULT '',
  possui_cnh     BOOLEAN,
  cnh_categoria  TEXT NOT NULL DEFAULT '',
  cnh_validade   TEXT NOT NULL DEFAULT '',
  celular        TEXT NOT NULL DEFAULT '',
  cidade         TEXT NOT NULL DEFAULT '',
  escala         TEXT NOT NULL DEFAULT '',
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Parâmetros da C.I. (linha única)
CREATE TABLE IF NOT EXISTS trein_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  meses_vigencia    INTEGER NOT NULL DEFAULT 3 CHECK (meses_vigencia BETWEEN 1 AND 24),
  remetente         TEXT NOT NULL DEFAULT 'AGRÍCOLA/DEPTO. CTT',
  destinatarios     TEXT NOT NULL DEFAULT 'RECURSOS HUMANOS',
  assunto           TEXT NOT NULL DEFAULT 'CONFECCÃO DE CRACHÁ DE TREINAMENTO',
  local             TEXT NOT NULL DEFAULT 'Ipiaçu-MG',
  texto_sem_cnh     TEXT NOT NULL DEFAULT 'CASO NÃO TIRE A CNH NO PERÍODO PROBATÓRIO, NÃO SERÁ CLASSIFICADO',
  assinatura_gestor BOOLEAN NOT NULL DEFAULT true
);
-- Gestores responsáveis (matrícula → nome e cargo impressos na assinatura da C.I.)
CREATE TABLE IF NOT EXISTS trein_gestores (
  matricula  TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  cargo      TEXT NOT NULL DEFAULT '',
  ativo      BOOLEAN NOT NULL DEFAULT true
);
-- Demais assinaturas da C.I. (fixas, editáveis em Parâmetros)
CREATE TABLE IF NOT EXISTS trein_signatarios (
  id     SERIAL PRIMARY KEY,
  nome   TEXT NOT NULL DEFAULT '',
  cargo  TEXT NOT NULL,
  ordem  INTEGER NOT NULL DEFAULT 1,
  ativo  BOOLEAN NOT NULL DEFAULT true
);
-- Treinamentos (aba Digitar): dados do colaborador gravados na hora do lançamento; a situação do colaborador é lida do cadastro
CREATE TABLE IF NOT EXISTS trein_registros (
  id                  SERIAL PRIMARY KEY,
  matricula           TEXT NOT NULL,
  nome                TEXT NOT NULL DEFAULT '',
  funcao              TEXT NOT NULL DEFAULT '',
  setor               TEXT NOT NULL DEFAULT '',
  data_admissao       DATE,
  situacao_colab      TEXT NOT NULL DEFAULT '',
  possui_cnh          BOOLEAN,
  cnh_categoria       TEXT NOT NULL DEFAULT '',
  cnh_validade        TEXT NOT NULL DEFAULT '',
  observacao          TEXT NOT NULL DEFAULT '',
  possui_curso        BOOLEAN,
  cursos              TEXT NOT NULL DEFAULT '',
  funcao_treinamento  TEXT NOT NULL DEFAULT '',
  setor_nova          TEXT NOT NULL DEFAULT '',
  vigencia_de         DATE NOT NULL,
  vigencia_ate        DATE NOT NULL,
  remetente           TEXT NOT NULL DEFAULT '',
  gestor_matricula    TEXT NOT NULL DEFAULT '',
  gestor_nome         TEXT NOT NULL DEFAULT '',
  gestor_funcao       TEXT NOT NULL DEFAULT '',
  contato             TEXT NOT NULL DEFAULT '',
  cidade              TEXT NOT NULL DEFAULT '',
  escala              TEXT NOT NULL DEFAULT '',
  situacao            TEXT CHECK (situacao IS NULL OR situacao IN ('TREINANDO','TREINADO','NÃO CLASSIFICADO','CANCELADO')),
  situacao_funcao     TEXT CHECK (situacao_funcao IS NULL OR situacao_funcao IN ('CLASSIFICADO','NÃO CLASSIFICADO','RENOVADO')),
  data_cracha         DATE,
  doc_numero          INTEGER,
  doc_ano             INTEGER,
  origem              TEXT NOT NULL DEFAULT 'digitado',
  criado_por          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trein_registros_mat_idx ON trein_registros (matricula, vigencia_de);
CREATE INDEX IF NOT EXISTS trein_registros_ate_idx ON trein_registros (vigencia_ate);
CREATE UNIQUE INDEX IF NOT EXISTS trein_registros_doc_idx ON trein_registros (doc_ano, doc_numero) WHERE doc_numero IS NOT NULL;
-- Nº DOC (Seq./ano) para todo treinamento, como na planilha: numera os que ficaram sem número
${SQL_NUMERAR_TREINO};
-- Numeração correta do Nº DOC: o ano é o da data do crachá (sem ela, o do início da vigência), cada ano recomeça do 1
-- e a ordem é a da data (no mesmo dia, mantém a ordem do número atual).
CREATE OR REPLACE VIEW trein_numeracao_correta AS
SELECT id, doc_ano, doc_numero, ano, n::int AS n FROM (
  SELECT id, doc_ano, doc_numero, ano, row_number() OVER (PARTITION BY ano
           ORDER BY dref, CASE WHEN doc_ano = ano THEN doc_numero END NULLS LAST, id) AS n
  FROM (SELECT id, doc_ano, doc_numero, COALESCE(data_cracha, vigencia_de) AS dref, extract(year FROM COALESCE(data_cracha, vigencia_de))::int AS ano
        FROM trein_registros) b
) x;
-- Chave do "mesmo treinamento": matrícula + início da vigência + função de treinamento (sem acento, maiúscula ou espaços a mais)
CREATE OR REPLACE FUNCTION trein_chave(mat text, vig date, func text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(trim(mat), '^0+(?=[0-9])', '') || '|' || vig::text || '|' ||
         regexp_replace(trim(upper(translate(func, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))), '[[:space:]]+', ' ', 'g')
$f$;
-- Aplica a numeração correta; devolve quantos treinamentos mudaram de número
CREATE OR REPLACE FUNCTION trein_ajustar_numeracao() RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE qtd integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _trein_num (id integer PRIMARY KEY, ano integer, n integer) ON COMMIT DROP;
  TRUNCATE _trein_num;
  INSERT INTO _trein_num SELECT id, ano, n FROM trein_numeracao_correta WHERE doc_ano IS DISTINCT FROM ano OR doc_numero IS DISTINCT FROM n;
  GET DIAGNOSTICS qtd = ROW_COUNT;
  IF qtd > 0 THEN
    UPDATE trein_registros r SET doc_numero = NULL, doc_ano = NULL FROM _trein_num t WHERE r.id = t.id;
    UPDATE trein_registros r SET doc_numero = t.n, doc_ano = t.ano FROM _trein_num t WHERE r.id = t.id;
  END IF;
  RETURN qtd;
END $f$;
ALTER TABLE trein_config ADD COLUMN IF NOT EXISTS numeracao_por_ano BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE trein_config ADD COLUMN IF NOT EXISTS limpeza_duplicados BOOLEAN NOT NULL DEFAULT false;

-- ============ Acompanhamento de ônibus ============
-- Frota: ônibus com os vencimentos dos documentos
CREATE TABLE IF NOT EXISTS onibus_frota (
  id                  SERIAL PRIMARY KEY,
  prefixo             TEXT NOT NULL UNIQUE,
  placa               TEXT NOT NULL UNIQUE,
  modelo              TEXT NOT NULL DEFAULT '',
  ano                 INTEGER CHECK (ano IS NULL OR ano BETWEEN 1950 AND 2100),
  capacidade          INTEGER CHECK (capacidade IS NULL OR capacidade BETWEEN 1 AND 200),
  proprietario        TEXT NOT NULL DEFAULT 'proprio' CHECK (proprietario IN ('proprio','terceiro')),
  empresa             TEXT NOT NULL DEFAULT '',
  venc_licenciamento  DATE,
  venc_tacografo      DATE,
  venc_vistoria       DATE,
  venc_seguro         DATE,
  observacao          TEXT NOT NULL DEFAULT '',
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Linhas (rotas): de onde para onde, horários previstos e km
CREATE TABLE IF NOT EXISTS onibus_linhas (
  id                SERIAL PRIMARY KEY,
  nome              TEXT NOT NULL UNIQUE,
  origem            TEXT NOT NULL DEFAULT '',
  destino           TEXT NOT NULL DEFAULT '',
  km_previsto       NUMERIC(8,1) CHECK (km_previsto IS NULL OR km_previsto >= 0),
  saida_prevista    TEXT CHECK (saida_prevista IS NULL OR saida_prevista ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  chegada_prevista  TEXT CHECK (chegada_prevista IS NULL OR chegada_prevista ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ativo             BOOLEAN NOT NULL DEFAULT true,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Viagens do dia: programado × realizado
CREATE TABLE IF NOT EXISTS onibus_viagens (
  id                SERIAL PRIMARY KEY,
  data              DATE NOT NULL,
  onibus_id         INTEGER NOT NULL REFERENCES onibus_frota(id),
  linha_id          INTEGER REFERENCES onibus_linhas(id) ON DELETE SET NULL,
  sentido           TEXT NOT NULL DEFAULT 'ida' CHECK (sentido IN ('ida','volta')),
  motorista         TEXT NOT NULL DEFAULT '',
  motorista_matricula TEXT NOT NULL DEFAULT '',
  turma             TEXT NOT NULL DEFAULT '',
  saida_prevista    TEXT CHECK (saida_prevista IS NULL OR saida_prevista ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  chegada_prevista  TEXT CHECK (chegada_prevista IS NULL OR chegada_prevista ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  saida_real        TEXT CHECK (saida_real IS NULL OR saida_real ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  chegada_real      TEXT CHECK (chegada_real IS NULL OR chegada_real ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  km_inicial        NUMERIC(10,1) CHECK (km_inicial IS NULL OR km_inicial >= 0),
  km_final          NUMERIC(10,1) CHECK (km_final IS NULL OR km_final >= 0),
  passageiros       INTEGER CHECK (passageiros IS NULL OR passageiros BETWEEN 0 AND 300),
  situacao          TEXT NOT NULL DEFAULT 'programada' CHECK (situacao IN ('programada','em_rota','concluida','cancelada')),
  observacao        TEXT NOT NULL DEFAULT '',
  criado_por        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onibus_viagens_data_idx ON onibus_viagens (data, saida_prevista);
CREATE INDEX IF NOT EXISTS onibus_viagens_onibus_idx ON onibus_viagens (onibus_id, data);
-- Ocorrências: atraso, quebra, acidente, reclamação… acompanhadas até resolver
CREATE TABLE IF NOT EXISTS onibus_ocorrencias (
  id            SERIAL PRIMARY KEY,
  data          DATE NOT NULL,
  hora          TEXT CHECK (hora IS NULL OR hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  onibus_id     INTEGER REFERENCES onibus_frota(id) ON DELETE SET NULL,
  viagem_id     INTEGER REFERENCES onibus_viagens(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('atraso','quebra','acidente','reclamacao','superlotacao','limpeza','outro')),
  descricao     TEXT NOT NULL,
  situacao      TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta','resolvida')),
  solucao       TEXT NOT NULL DEFAULT '',
  resolvida_em  DATE,
  criado_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onibus_ocorrencias_data_idx ON onibus_ocorrencias (data);
-- Frota da planilha diária: o nº de frota pode não ser placa; ordem das linhas e a última vistoria (vale 30 dias)
ALTER TABLE onibus_frota ALTER COLUMN placa DROP NOT NULL;
ALTER TABLE onibus_frota ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0;
ALTER TABLE onibus_frota ADD COLUMN IF NOT EXISTS ultima_vistoria DATE;
-- Planilha diária (Levantamento Transporte Funcionários): uma linha por ônibus por dia
CREATE TABLE IF NOT EXISTS onibus_diario (
  id               SERIAL PRIMARY KEY,
  data             DATE NOT NULL,
  onibus_id        INTEGER NOT NULL REFERENCES onibus_frota(id) ON DELETE CASCADE,
  empresa          TEXT NOT NULL DEFAULT '',
  capacidade       INTEGER CHECK (capacidade IS NULL OR capacidade BETWEEN 0 AND 300),
  passageiros      INTEGER CHECK (passageiros IS NULL OR passageiros BETWEEN 0 AND 300),
  ultima_vistoria  DATE,
  lavagem_1        DATE,
  lavagem_2        DATE,
  atividade        TEXT NOT NULL DEFAULT '',
  rota_ida         TEXT NOT NULL DEFAULT '',
  rota_volta       TEXT NOT NULL DEFAULT '',
  situacao         TEXT NOT NULL DEFAULT 'liberado' CHECK (situacao IN ('liberado','manutencao','reserva','interditado','parado')),
  observacao       TEXT NOT NULL DEFAULT '',
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data, onibus_id)
);
CREATE INDEX IF NOT EXISTS onibus_diario_data_idx ON onibus_diario (data);
-- Observação geral do dia (rodapé da planilha)
CREATE TABLE IF NOT EXISTS onibus_diario_obs (
  data          DATE PRIMARY KEY,
  observacao    TEXT NOT NULL DEFAULT '',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Atividades da frota: quantos ônibus estão previstos em cada uma e as palavras da coluna ATIVIDADE que indicam a atividade
-- (alternativas separadas por vírgula; "A+B" = precisa ter A e B; vale a palavra mais específica). A ordem é a dos gráficos.
DO $$
BEGIN
  IF to_regclass('public.onibus_atividades') IS NULL THEN
    CREATE TABLE onibus_atividades (
      id        SERIAL PRIMARY KEY,
      nome      TEXT NOT NULL UNIQUE,
      previsto  INTEGER NOT NULL DEFAULT 0 CHECK (previsto BETWEEN 0 AND 200),
      palavras  TEXT NOT NULL DEFAULT '',
      ordem     INTEGER NOT NULL DEFAULT 0,
      ativo     BOOLEAN NOT NULL DEFAULT true
    );
    INSERT INTO onibus_atividades (nome, previsto, palavras, ordem) VALUES
      ('Frentes (CTT)', 6, 'FRENTE, MOTORISTA', 10),
      ('Irrigação Localizada', 1, 'LOCALIZADA', 20),
      ('Irrigação Convencional', 1, 'IRRIGACAO, IRRIGA', 30),
      ('Herbicida (Tratos)', 4, 'HERBICIDA, TRATOS', 40),
      ('Reflorestamento', 1, 'REFLOREST', 50),
      ('Indústria Capinópolis', 6, 'INDUSTRIA+CAPINOPOLIS', 60),
      ('Indústria Ipiaçu', 2, 'INDUSTRIA+IPIACU', 70),
      ('Indústria Ituiutaba', 2, 'INDUSTRIA+ITUIUTABA', 80);
  END IF;
END $$;
-- os motoristas contam nas Frentes (CTT) — só muda quem ainda está com a palavra original
UPDATE onibus_atividades SET palavras = 'FRENTE, MOTORISTA' WHERE nome = 'Frentes (CTT)' AND palavras = 'FRENTE';
-- Quando o RESUMO do dia foi alterado pela última vez (digitação, inclusão, exclusão, observação, importação)
ALTER TABLE onibus_diario_obs ADD COLUMN IF NOT EXISTS alterado_em TIMESTAMPTZ;
-- BASE: o RESUMO de cada dia como foi salvo (botão "Salvar na BASE"); a disponibilidade sai daqui
DO $$
BEGIN
  IF to_regclass('public.onibus_base') IS NULL THEN
    CREATE TABLE onibus_base (
      id               SERIAL PRIMARY KEY,
      data             DATE NOT NULL,
      onibus_id        INTEGER NOT NULL REFERENCES onibus_frota(id) ON DELETE CASCADE,
      empresa          TEXT NOT NULL DEFAULT '',
      capacidade       INTEGER CHECK (capacidade IS NULL OR capacidade BETWEEN 0 AND 300),
      passageiros      INTEGER CHECK (passageiros IS NULL OR passageiros BETWEEN 0 AND 300),
      ultima_vistoria  DATE,
      lavagem_1        DATE,
      lavagem_2        DATE,
      atividade        TEXT NOT NULL DEFAULT '',
      rota_ida         TEXT NOT NULL DEFAULT '',
      rota_volta       TEXT NOT NULL DEFAULT '',
      situacao         TEXT NOT NULL DEFAULT 'liberado' CHECK (situacao IN ('liberado','manutencao','reserva','interditado','parado')),
      observacao       TEXT NOT NULL DEFAULT '',
      UNIQUE (data, onibus_id)
    );
    CREATE INDEX onibus_base_data_idx ON onibus_base (data);
    CREATE TABLE onibus_base_dias (
      data            DATE PRIMARY KEY,
      linhas          INTEGER NOT NULL DEFAULT 0,
      observacao      TEXT NOT NULL DEFAULT '',
      salvo_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
      salvo_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      salvo_por_nome  TEXT NOT NULL DEFAULT '',
      origem          TEXT NOT NULL DEFAULT 'resumo'
    );
    -- uma vez só: os dias já lançados antes do botão Salvar entram na BASE como salvos
    INSERT INTO onibus_base (data, onibus_id, empresa, capacidade, passageiros, ultima_vistoria, lavagem_1, lavagem_2, atividade, rota_ida, rota_volta, situacao, observacao)
      SELECT data, onibus_id, empresa, capacidade, passageiros, ultima_vistoria, lavagem_1, lavagem_2, atividade, rota_ida, rota_volta, situacao, observacao FROM onibus_diario;
    INSERT INTO onibus_base_dias (data, linhas, observacao, salvo_por_nome, origem)
      SELECT d.data, count(*), COALESCE(max(o.observacao), ''), 'migração', 'migracao'
        FROM onibus_diario d LEFT JOIN onibus_diario_obs o ON o.data = d.data GROUP BY d.data;
  END IF;
END $$;

-- ============ Controle Operacional – Transporte: documentação dos veículos leves e pesados ============
CREATE TABLE IF NOT EXISTS op_veiculos (
  id              SERIAL PRIMARY KEY,
  placa           TEXT UNIQUE,
  frota           TEXT UNIQUE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('leve','pesado')),
  categoria       TEXT NOT NULL DEFAULT '',
  marca_modelo    TEXT NOT NULL DEFAULT '',
  ano             INTEGER CHECK (ano IS NULL OR ano BETWEEN 1950 AND 2100),
  renavam         TEXT NOT NULL DEFAULT '',
  chassi          TEXT NOT NULL DEFAULT '',
  combustivel     TEXT NOT NULL DEFAULT '',
  propriedade     TEXT NOT NULL DEFAULT 'proprio' CHECK (propriedade IN ('proprio','locado','terceiro')),
  empresa         TEXT NOT NULL DEFAULT '',
  setor           TEXT NOT NULL DEFAULT '',
  responsavel     TEXT NOT NULL DEFAULT '',
  situacao        TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','manutencao','reserva','baixado')),
  observacao      TEXT NOT NULL DEFAULT '',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (placa IS NOT NULL OR frota IS NOT NULL)
);
-- Tipos de documento: validade (dias), para quais veículos e se é obrigatório (sem ele, o veículo fica "faltando")
DO $$
BEGIN
  IF to_regclass('public.op_tipos_documento') IS NULL THEN
    CREATE TABLE op_tipos_documento (
      id           SERIAL PRIMARY KEY,
      nome         TEXT NOT NULL UNIQUE,
      aplica       TEXT NOT NULL DEFAULT 'ambos' CHECK (aplica IN ('leve','pesado','ambos')),
      obrigatorio  BOOLEAN NOT NULL DEFAULT false,
      validade_dias INTEGER CHECK (validade_dias IS NULL OR validade_dias BETWEEN 1 AND 3650),
      aviso_dias   INTEGER NOT NULL DEFAULT 30 CHECK (aviso_dias BETWEEN 0 AND 365),
      ordem        INTEGER NOT NULL DEFAULT 0,
      ativo        BOOLEAN NOT NULL DEFAULT true
    );
    INSERT INTO op_tipos_documento (nome, aplica, obrigatorio, validade_dias, aviso_dias, ordem) VALUES
      ('CRLV / Licenciamento anual', 'ambos', true, 365, 30, 10),
      ('Seguro do veículo (apólice)', 'ambos', true, 365, 30, 20),
      ('IPVA', 'ambos', false, 365, 30, 30),
      ('Checklist / vistoria interna', 'ambos', false, 30, 5, 40),
      ('Aferição do tacógrafo (INMETRO)', 'pesado', true, 730, 30, 50),
      ('Laudo de opacidade (fumaça preta)', 'pesado', true, 365, 30, 60),
      ('Inspeção de segurança veicular (CSV)', 'pesado', false, 365, 30, 70),
      ('ANTT / RNTRC', 'pesado', false, 1825, 60, 80),
      ('AET – Autorização Especial de Trânsito', 'pesado', false, 365, 30, 90),
      ('CIV / CIPP – produtos perigosos', 'pesado', false, 365, 30, 100),
      ('Contrato de locação', 'ambos', false, NULL, 30, 110);
  END IF;
END $$;
-- Documentos de cada veículo (o mais recente de cada tipo vale; os anteriores ficam no histórico)
CREATE TABLE IF NOT EXISTS op_documentos (
  id            SERIAL PRIMARY KEY,
  veiculo_id    INTEGER NOT NULL REFERENCES op_veiculos(id) ON DELETE CASCADE,
  tipo_id       INTEGER NOT NULL REFERENCES op_tipos_documento(id),
  numero        TEXT NOT NULL DEFAULT '',
  emissao       DATE,
  vencimento    DATE,
  observacao    TEXT NOT NULL DEFAULT '',
  criado_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS op_documentos_veiculo_idx ON op_documentos (veiculo_id, tipo_id);
-- Arquivo do documento (PDF/JPG/PNG até 5 MB), guardado no banco: o disco do Render é efêmero
CREATE TABLE IF NOT EXISTS op_arquivos (
  id            SERIAL PRIMARY KEY,
  documento_id  INTEGER NOT NULL REFERENCES op_documentos(id) ON DELETE CASCADE,
  nome_arquivo  TEXT NOT NULL,
  tipo_mime     TEXT NOT NULL,
  tamanho       INTEGER NOT NULL,
  conteudo      BYTEA NOT NULL,
  enviado_por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS op_arquivos_doc_idx ON op_arquivos (documento_id);

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
-- Formulário padrão RE.0150.03 (Ficha de Informe de Contratação), versão 03 de 03/02/2023 — texto do cabeçalho como no modelo
INSERT INTO documentos_re (codigo, titulo, sistema, versao, data_versao, periodicidade, empresa, cidade)
VALUES ('RE.0150.03', 'FICHA DE INFORME DE CONTRATAÇÃO', 'Sistema de Gestão Integrada - SGI', '03', '2023-02-03', 'Sempre que houver contratação',
        'CRV INDUSTRIAL LTDA', 'Capinópolis-MG')
ON CONFLICT (codigo) DO NOTHING;
-- C.I. do crachá de treinamento: cabeçalho como no modelo da empresa (RE. 0940.02D, versão 02 de 17/04/2023)
INSERT INTO documentos_re (codigo, titulo, sistema, versao, data_versao, periodicidade, empresa, cidade)
VALUES ('RE. 0940.02D', 'COMUNICAÇÃO INTERNA (C.I)', 'Sistema de Gestão Integrada - SGI', '02', '2023-04-17', 'A cada comunicação',
        'CRV INDUSTRIAL LTDA', 'Ipiaçu-MG')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO trein_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
-- Uma vez: tira os treinamentos repetidos (mesma matrícula, início e função; fica o mais atualizado) e refaz o Nº DOC
-- de todos pela data (cada ano recomeça do 1)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM trein_config WHERE id = 1 AND NOT limpeza_duplicados) THEN
    DELETE FROM trein_registros r USING (
      SELECT id, row_number() OVER (PARTITION BY trein_chave(matricula, vigencia_de, funcao_treinamento) ORDER BY atualizado_em DESC, id) AS rn
      FROM trein_registros
    ) d WHERE r.id = d.id AND d.rn > 1;
    PERFORM trein_ajustar_numeracao();
    UPDATE trein_config SET limpeza_duplicados = true, numeracao_por_ano = true WHERE id = 1;
  END IF;
END $$;
-- Assinaturas fixas da C.I. (a do gestor responsável vem do treinamento); editáveis em Treinamento prático → Parâmetros
INSERT INTO trein_signatarios (nome, cargo, ordem)
SELECT n, c, o FROM (VALUES
  ('23504 - Fabio Leandro da Silva Junior', 'Coordenador de Treinamento e Desenvolvimento', 2),
  ('34939 – João Eduardo dos Santos', 'Gerente Transporte e Mecanização', 3),
  ('Cloves Oliveira', 'Gerente Agrícola', 4),
  ('Michelle Patrícia Alves Pereira', 'Coordenadora de RH', 5)) AS v(n, c, o)
WHERE NOT EXISTS (SELECT 1 FROM trein_signatarios);

-- Gratificação rescisória: parâmetros iniciais (editáveis em Gratificação rescisória → Parâmetros)
INSERT INTO grat_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Quem assina o demonstrativo (como no modelo da aba Diversos); editável em Gratificação rescisória → Parâmetros
INSERT INTO grat_signatarios (cargo, ordem)
SELECT c, o FROM (VALUES ('COORDENADOR AGRÍCOLA', 1), ('GERENTE TRANSPORTE E MECANIZAÇÃO', 2), ('SUPERINTENDENTE AGRÍCOLA', 3), ('GERENTE EXECUTIVO', 4)) AS v(c, o)
WHERE NOT EXISTS (SELECT 1 FROM grat_signatarios);
-- Nomes do modelo; só preenche quem ainda está sem nome (não sobrescreve o que o administrador alterou)
UPDATE grat_signatarios s SET nome = v.nome
FROM (VALUES ('COORDENADOR AGRÍCOLA', '29117 - AURENIO DE OLIVEIRA LIMA'), ('GERENTE TRANSPORTE E MECANIZAÇÃO', '34939 - JOAO EDUARDO DOS SANTOS'),
             ('SUPERINTENDENTE AGRÍCOLA', 'CLOVES RODRIGUES DE OLIVEIRA JUNIOR'), ('GERENTE EXECUTIVO', 'LEONARDO DIAS ALMEIDA')) AS v(cargo, nome)
WHERE s.cargo = v.cargo AND s.nome = '';

INSERT INTO grat_criterios (tipo_rescisao, pagar_bpp, pagar_zelo, pagar_prod, pagar_gold) VALUES
  ('PEDIDO DE DEMISSÃO',             true,  true,  true,  true),
  ('DEMISSÃO S/ J. CAUSA',           false, true,  true,  true),
  ('TERMINO CONTRATO - FIM DE SAFRA', true,  true,  true,  true),
  ('FALECIMENTO',                    true,  true,  true,  true),
  ('DEMISSÃO C/ J. CAUSA',           false, false, false, false),
  ('COMUM ACORDO',                   true,  true,  true,  true),
  ('TERMINO CONTRATO',               true,  true,  true,  true)
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

module.exports = { SCHEMA, SEEDS, PERFIS, SQL_NUMERAR_TREINO };
