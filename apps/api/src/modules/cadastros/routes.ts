import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { atorDe } from '../../core/rbac/ator.js';
import * as servico from './service.js';
import type { RecursoCadastro } from './service.js';

const motivoSchema = z.object({
  motivo: z.string().min(5, 'Informe o motivo com ao menos 5 caracteres.'),
});

interface Registro {
  recurso: RecursoCadastro;
  /** caminho ja usado pelo frontend para listar e criar */
  caminho: string;
  permissao: string;
}

/**
 * Edicao e inativacao dos cadastros. Os caminhos espelham os de listagem
 * e criacao, que vivem nos modulos de dominio - aqui ficam apenas as operacoes
 * que compartilham a mesma regra (secao 13: nada se exclui).
 */
const RECURSOS: Registro[] = [
  { recurso: 'veiculo', caminho: '/transporte/veiculos', permissao: 'veiculo:gerenciar' },
  { recurso: 'motorista', caminho: '/transporte/motoristas', permissao: 'motorista:gerenciar' },
  { recurso: 'item', caminho: '/compras/itens', permissao: 'item:gerenciar' },
  { recurso: 'fornecedor', caminho: '/compras/fornecedores', permissao: 'fornecedor:gerenciar' },
  { recurso: 'almoxarifado', caminho: '/almoxarifado/almoxarifados', permissao: 'inventario:gerenciar' },
  { recurso: 'rota', caminho: '/portaria/rotas', permissao: 'portaria:gerenciar' },
  { recurso: 'colaborador', caminho: '/pessoas/colaboradores', permissao: 'colaborador:gerenciar' },
];

export const cadastrosRoutes: FastifyPluginAsync = async (app) => {
  for (const { recurso, caminho, permissao } of RECURSOS) {
    app.patch(`${caminho}/:id`, { preHandler: [app.autenticar, app.exigirPermissao(permissao)] }, async (req) => {
      const { id } = req.params as { id: string };
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      return servico.editar(atorDe(req), recurso, id, corpo);
    });

    app.post(`${caminho}/:id/inativar`, { preHandler: [app.autenticar, app.exigirPermissao(permissao)] }, async (req) => {
      const { id } = req.params as { id: string };
      const { motivo } = motivoSchema.parse(req.body);
      return servico.inativar(atorDe(req), recurso, id, motivo);
    });

    app.post(`${caminho}/:id/reativar`, { preHandler: [app.autenticar, app.exigirPermissao(permissao)] }, async (req) => {
      const { id } = req.params as { id: string };
      const { motivo } = motivoSchema.parse(req.body);
      return servico.reativar(atorDe(req), recurso, id, motivo);
    });

    app.get(`${caminho}/:id/campos-editaveis`, { preHandler: [app.autenticar, app.exigirPermissao(permissao)] }, async () => ({
      campos: servico.camposEditaveis(recurso),
    }));
  }
};
