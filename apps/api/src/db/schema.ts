// Schema do banco local (SQLite) do Gerador de Croqui.
// App standalone, sem relacao com o Supabase/ERP da empresa (decisao
// registrada no README): fica tudo aqui, em apps/api/data/croqui.db.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projetos (
  id TEXT PRIMARY KEY,
  nome_cliente TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plantas (
  id TEXT PRIMARY KEY,
  projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  formato_original TEXT NOT NULL,
  status TEXT NOT NULL,
  nome_arquivo_original TEXT NOT NULL,
  formato_exibicao TEXT,
  mensagem_erro TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questionarios (
  projeto_id TEXT PRIMARY KEY REFERENCES projetos(id) ON DELETE CASCADE,
  servicos TEXT NOT NULL DEFAULT '[]', -- JSON array de ServiceCategory
  observacoes TEXT,
  configuracao_json TEXT NOT NULL DEFAULT '{}',
  atualizado_em TEXT NOT NULL
);

-- Uma versao salva do arranjo de simbolos do croqui. Nunca sobrescrita:
-- cada "salvar" cria uma nova linha com versao = anterior + 1.
CREATE TABLE IF NOT EXISTS croquis (
  id TEXT PRIMARY KEY,
  projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (projeto_id, versao)
);

CREATE TABLE IF NOT EXISTS croqui_pontos (
  id TEXT PRIMARY KEY,
  croqui_id TEXT NOT NULL REFERENCES croquis(id) ON DELETE CASCADE,
  planta_id TEXT REFERENCES plantas(id) ON DELETE SET NULL,
  simbolo_id TEXT NOT NULL, -- id de SIMBOLOS_PADRAO (packages/shared)
  ambiente TEXT,
  pos_x REAL NOT NULL,
  pos_y REAL NOT NULL,
  rotacao REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plantas_projeto ON plantas(projeto_id);
CREATE INDEX IF NOT EXISTS idx_croquis_projeto ON croquis(projeto_id);
CREATE INDEX IF NOT EXISTS idx_pontos_croqui ON croqui_pontos(croqui_id);
`;
