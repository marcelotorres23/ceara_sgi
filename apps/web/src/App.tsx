import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './modules/auth/LoginPage';
import { TrocarSenha } from './modules/auth/TrocarSenha';
import { AppShell } from './modules/shell/AppShell';
import { PainelInicial } from './modules/shell/PainelInicial';
import { PainelKanban } from './modules/compras/PainelKanban';
import { MinhasSolicitacoes } from './modules/compras/MinhasSolicitacoes';
import { NovaSolicitacao } from './modules/compras/NovaSolicitacao';
import { Triagem } from './modules/compras/Triagem';
import { DetalheLote } from './modules/compras/DetalheLote';
import { FilaAprovacao } from './modules/compras/FilaAprovacao';
import { LimiteDeErro } from './design-system/components/LimiteDeErro';
import { PainelAlertas } from './modules/almoxarifado/PainelAlertas';
import { PainelCco } from './modules/transporte/PainelCco';
import { Pneus } from './modules/frota/Pneus';
import { ControleOleo } from './modules/frota/ControleOleo';
import { Baterias } from './modules/frota/Baterias';
import { Manutencao } from './modules/frota/Manutencao';
import { Abastecimento } from './modules/frota/Abastecimento';
import { RelatoriosFrota } from './modules/frota/RelatoriosFrota';
import { Pessoas } from './modules/pessoas/Pessoas';
import { Portaria } from './modules/portaria/Portaria';
import { Governanca } from './modules/governanca/Governanca';
import { PainelExecutivo } from './modules/bi/PainelExecutivo';
import { Cadastros } from './modules/cadastros/Cadastros';
import { Matinal } from './modules/matinal/Matinal';
import { useSessao } from './modules/auth/useSessao';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function RotaProtegida({ children }: { children: React.ReactNode }) {
  const { usuario, carregando } = useSessao();
  if (carregando) return <div className="grid min-h-screen place-items-center text-corpo text-ceara-texto2">Carregando...</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  // senha entregue por terceiro serve para entrar uma vez, nao para operar (secao 5.1)
  if (usuario.deveTrocarSenha) return <TrocarSenha obrigatoria />;
  return <>{children}</>;
}

export function App() {
  const carregar = useSessao((s) => s.carregar);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RotaProtegida>
                <AppShell />
              </RotaProtegida>
            }
          >
            <Route index element={<PainelInicial />} />
            <Route
              path="compras"
              element={
                <LimiteDeErro regiao="o painel de compras">
                  <PainelKanban />
                </LimiteDeErro>
              }
            />
            <Route
              path="compras/lotes/:id"
              element={
                <LimiteDeErro regiao="o detalhe do lote">
                  <DetalheLote />
                </LimiteDeErro>
              }
            />
            <Route
              path="aprovacoes"
              element={
                <LimiteDeErro regiao="a fila de aprovacao">
                  <FilaAprovacao />
                </LimiteDeErro>
              }
            />
            <Route
              path="solicitacoes"
              element={
                <LimiteDeErro regiao="as solicitacoes de compra">
                  <MinhasSolicitacoes />
                </LimiteDeErro>
              }
            />
            <Route
              path="solicitacoes/nova"
              element={
                <LimiteDeErro regiao="a abertura de solicitacao">
                  <NovaSolicitacao />
                </LimiteDeErro>
              }
            />
            <Route
              path="triagem"
              element={
                <LimiteDeErro regiao="a fila de triagem">
                  <Triagem />
                </LimiteDeErro>
              }
            />
            <Route
              path="frota"
              element={
                <LimiteDeErro regiao="o painel da frota">
                  <PainelCco />
                </LimiteDeErro>
              }
            />
            <Route
              path="pneus"
              element={
                <LimiteDeErro regiao="a gestao de pneus">
                  <Pneus />
                </LimiteDeErro>
              }
            />
            <Route
              path="oleo"
              element={
                <LimiteDeErro regiao="o controle de oleo e lubrificacao">
                  <ControleOleo />
                </LimiteDeErro>
              }
            />
            <Route
              path="baterias"
              element={
                <LimiteDeErro regiao="o controle de baterias">
                  <Baterias />
                </LimiteDeErro>
              }
            />
            <Route
              path="abastecimento"
              element={
                <LimiteDeErro regiao="o abastecimento interno">
                  <Abastecimento />
                </LimiteDeErro>
              }
            />
            <Route
              path="manutencao"
              element={
                <LimiteDeErro regiao="a manutencao">
                  <Manutencao />
                </LimiteDeErro>
              }
            />
            <Route
              path="portaria"
              element={
                <LimiteDeErro regiao="a portaria">
                  <Portaria />
                </LimiteDeErro>
              }
            />
            <Route
              path="almoxarifado"
              element={
                <LimiteDeErro regiao="os alertas de estoque">
                  <PainelAlertas />
                </LimiteDeErro>
              }
            />
            <Route
              path="cadastros/*"
              element={
                <LimiteDeErro regiao="os cadastros">
                  <Cadastros />
                </LimiteDeErro>
              }
            />
            <Route
              path="pessoas"
              element={
                <LimiteDeErro regiao="a gestao de pessoas">
                  <Pessoas />
                </LimiteDeErro>
              }
            />
            <Route
              path="executivo"
              element={
                <LimiteDeErro regiao="o painel executivo">
                  <PainelExecutivo />
                </LimiteDeErro>
              }
            />
            <Route
              path="indicadores"
              element={
                <LimiteDeErro regiao="os relatorios de frota">
                  <RelatoriosFrota />
                </LimiteDeErro>
              }
            />
            <Route
              path="matinal"
              element={
                <LimiteDeErro regiao="a matinal">
                  <Matinal />
                </LimiteDeErro>
              }
            />
            <Route
              path="governanca"
              element={
                <LimiteDeErro regiao="a governanca">
                  <Governanca />
                </LimiteDeErro>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
