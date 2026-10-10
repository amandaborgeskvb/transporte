// Comprovantes (PDF/JPG/PNG até 5 MB) guardados no PostgreSQL: o disco do Render é efêmero.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, idParam, opcaoDe, inteiro, auditar, erro400, erro403, erro404 } = require('../util');
const { carregarViagem, acoesViagem, ADM, FIN } = require('../workflow');

const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS_ACEITOS = ['application/pdf', 'image/png', 'image/jpeg'];
const TABELA = { despesa: 'despesas', adiantamento: 'adiantamentos', reembolso: 'reembolsos' };

// O tipo real vem dos primeiros bytes, não do cabeçalho enviado pelo cliente.
function detectarTipo(buf) {
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

const nomeSeguro = (n) => texto(n, 120).replace(/[\\/\r\n"]/g, '_') || 'comprovante';

function criarAnexos({ pool }) {
  const router = express.Router();

  // Envio: corpo = bytes do arquivo; metadados na query (?entidade=despesa&id=12&nome=nota.pdf)
  router.post('/anexos',
    express.raw({ type: TIPOS_ACEITOS, limit: MAX_BYTES }),
    wrap(async (req, res) => {
      const entidade = opcaoDe(req.query.entidade, Object.keys(TABELA), 'Entidade');
      const entidadeId = inteiro(req.query.id, 'ID');
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie um arquivo PDF, JPG ou PNG de até 5 MB.');
      const tipo = detectarTipo(req.body);
      if (!tipo) throw erro400('Formato não aceito. Use PDF, JPG ou PNG.');
      const nome = nomeSeguro(req.query.nome);

      const criado = await tx(pool, async (db) => {
        const item = (await db.query(`SELECT viagem_id FROM ${TABELA[entidade]} WHERE id=$1`, [entidadeId])).rows[0];
        if (!item) throw erro404('Registro não encontrado.');
        const v = await carregarViagem(db, item.viagem_id, req.usuario, { travar: true });
        // Quem pode lançar na viagem pode anexar (aprovador só consulta)
        const pode = acoesViagem(req.usuario, v).some((a) => ['lancar_despesa', 'solicitar_adiantamento', 'solicitar_reembolso'].includes(a));
        if (!pode && ![ADM, FIN].includes(req.usuario.perfil)) throw erro403('Você não pode anexar comprovantes nesta viagem.');
        const n = (await db.query('SELECT COUNT(*)::int AS n FROM anexos WHERE entidade=$1 AND entidade_id=$2', [entidade, entidadeId])).rows[0].n;
        if (n >= 10) throw erro400('Limite de 10 comprovantes por lançamento.');
        const { rows } = await db.query(
          `INSERT INTO anexos (viagem_id, entidade, entidade_id, nome_arquivo, tipo_mime, tamanho, conteudo, enviado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nome_arquivo, tipo_mime, tamanho`,
          [v.id, entidade, entidadeId, nome, tipo, req.body.length, req.body, req.usuario.id]);
        await auditar(db, req.usuario, 'anexar', entidade, entidadeId, { arquivo: nome, bytes: req.body.length }, v.id);
        return rows[0];
      });
      res.status(201).json(criado);
    }));

  router.get('/anexos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const a = (await pool.query('SELECT * FROM anexos WHERE id=$1', [id])).rows[0];
    if (!a) throw erro404('Comprovante não encontrado.');
    await carregarViagem(pool, a.viagem_id, req.usuario); // respeita o escopo de visibilidade
    res.set({
      'Content-Type': a.tipo_mime,
      'Content-Length': a.conteudo.length,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nome_arquivo)}`,
      'Cache-Control': 'private, no-store',
    });
    res.send(a.conteudo);
  }));

  router.delete('/anexos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await tx(pool, async (db) => {
      const a = (await db.query('SELECT id, viagem_id, entidade, entidade_id, nome_arquivo, enviado_por FROM anexos WHERE id=$1', [id])).rows[0];
      if (!a) throw erro404('Comprovante não encontrado.');
      const v = await carregarViagem(db, a.viagem_id, req.usuario, { travar: true });
      if (v.prestacao_situacao === 'aprovada') throw erro403('A prestação de contas já foi aprovada.');
      const pode = [ADM, FIN].includes(req.usuario.perfil) || a.enviado_por === req.usuario.id;
      if (!pode) throw erro403('Só quem enviou o comprovante (ou o financeiro/administrador) pode removê-lo.');
      await db.query('DELETE FROM anexos WHERE id=$1', [id]);
      await auditar(db, req.usuario, 'remover_anexo', a.entidade, a.entidade_id, { arquivo: a.nome_arquivo }, v.id);
    });
    res.status(204).end();
  }));

  return router;
}

module.exports = { criarAnexos, MAX_BYTES };
