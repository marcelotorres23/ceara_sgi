import { describe, expect, it } from 'vitest';
import { lerNotaDeCombustivel } from './nfe-combustivel.js';

/** NF-e reduzida ao que a entrada no tanque usa; o resto do layout nao muda o comportamento. */
const nfe = (opcoes: { itens: string; total?: string; ide?: string; emit?: string } = { itens: '' }) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="NFe35260812345678000199550010000123451000123456" versao="4.00">
      <ide>
        ${opcoes.ide ?? '<nNF>12345</nNF><serie>1</serie><dhEmi>2026-08-15T09:30:00-03:00</dhEmi>'}
      </ide>
      <emit>
        ${opcoes.emit ?? '<CNPJ>12345678000199</CNPJ><xNome>DISTRIBUIDORA DE COMBUSTIVEIS LTDA</xNome><xFant>POSTO CENTRAL</xFant>'}
      </emit>
      ${opcoes.itens}
      <total><ICMSTot>${opcoes.total ?? '<vNF>31000.00</vNF>'}</ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

const item = (p: { desc: string; qtd: string; unit: string; total: string; un?: string; cod?: string }) => `
  <det nItem="1">
    <prod>
      <cProd>${p.cod ?? '001'}</cProd>
      <xProd>${p.desc}</xProd>
      <uCom>${p.un ?? 'LT'}</uCom>
      <qCom>${p.qtd}</qCom>
      <vUnCom>${p.unit}</vUnCom>
      <vProd>${p.total}</vProd>
    </prod>
  </det>`;

describe('lerNotaDeCombustivel', () => {
  it('extrai fornecedor, numero e data da nota', () => {
    const n = lerNotaDeCombustivel(nfe({ itens: item({ desc: 'OLEO DIESEL B S10', qtd: '5000.000', unit: '6.2000', total: '31000.00' }) }));

    expect(n.fornecedor.cnpj).toBe('12345678000199');
    expect(n.fornecedor.razaoSocial).toBe('DISTRIBUIDORA DE COMBUSTIVEIS LTDA');
    expect(n.numero).toBe('12345');
    expect(n.serie).toBe('1');
    expect(n.emitidaEm?.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(n.chave).toBe('35260812345678000199550010000123451000123456');
  });

  it('traz litros, valor e custo do litro do combustivel', () => {
    const n = lerNotaDeCombustivel(nfe({ itens: item({ desc: 'OLEO DIESEL B S10', qtd: '5000.000', unit: '6.2000', total: '31000.00' }) }));

    expect(n.litrosDeCombustivel).toBe('5000.000');
    expect(n.valorDeCombustivel).toBe('31000.00');
    expect(n.custoUnitarioMedio).toBe('6.2000');
    expect(n.avisos).toEqual([]);
  });

  it('custo do litro e ponderado pelo volume, e nao media dos precos', () => {
    // 1.000 L a 6,00 e 4.000 L a 6,50 → (6.000 + 26.000) / 5.000 = 6,40, e nao 6,25
    const xml = nfe({
      itens:
        item({ desc: 'OLEO DIESEL S10', qtd: '1000.000', unit: '6.0000', total: '6000.00' }) +
        item({ desc: 'OLEO DIESEL S10', qtd: '4000.000', unit: '6.5000', total: '26000.00', cod: '002' }),
      total: '<vNF>32000.00</vNF>',
    });

    const n = lerNotaDeCombustivel(xml);
    expect(n.litrosDeCombustivel).toBe('5000.000');
    expect(n.custoUnitarioMedio).toBe('6.4000');
  });

  it('separa o que e combustivel do que e frete ou lubrificante em balde', () => {
    const xml = nfe({
      itens:
        item({ desc: 'OLEO DIESEL B S10', qtd: '5000.000', unit: '6.2000', total: '31000.00' }) +
        item({ desc: 'FRETE', qtd: '1.000', unit: '800.0000', total: '800.00', un: 'UN', cod: '999' }) +
        item({ desc: 'OLEO LUBRIFICANTE 15W40 BALDE', qtd: '20.000', unit: '25.0000', total: '500.00', un: 'UN', cod: '888' }),
      total: '<vNF>32300.00</vNF>',
    });

    const n = lerNotaDeCombustivel(xml);
    expect(n.itens).toHaveLength(3);
    // so o diesel entra no volume que desce para o tanque
    expect(n.litrosDeCombustivel).toBe('5000.000');
    expect(n.valorDeCombustivel).toBe('31000.00');
    expect(n.itens.filter((i) => i.ehCombustivel)).toHaveLength(1);
  });

  it('avisa quando o total da nota nao bate com os itens de combustivel', () => {
    const xml = nfe({
      itens:
        item({ desc: 'OLEO DIESEL B S10', qtd: '5000.000', unit: '6.2000', total: '31000.00' }) +
        item({ desc: 'FRETE', qtd: '1.000', unit: '800.0000', total: '800.00', un: 'UN', cod: '999' }),
      total: '<vNF>31800.00</vNF>',
    });

    const n = lerNotaDeCombustivel(xml);
    expect(n.avisos.some((a) => a.includes('frete'))).toBe(true);
  });

  it('avisa quando nenhum item parece combustivel, em vez de lancar zero', () => {
    const n = lerNotaDeCombustivel(nfe({ itens: item({ desc: 'PECA DE REPOSICAO', qtd: '2.000', unit: '50.0000', total: '100.00', un: 'UN' }) }));

    expect(n.litrosDeCombustivel).toBe('0.000');
    expect(n.custoUnitarioMedio).toBeNull();
    expect(n.avisos.some((a) => a.includes('Nenhum item'))).toBe(true);
  });

  it('reconhece Arla como produto de tanque', () => {
    const n = lerNotaDeCombustivel(nfe({ itens: item({ desc: 'ARLA 32 GRANEL', qtd: '1000.000', unit: '3.5000', total: '3500.00' }) }));
    expect(n.litrosDeCombustivel).toBe('1000.000');
  });

  it('le a nota sem o envelope do portal, como vem por e-mail', () => {
    const semEnvelope = nfe({ itens: item({ desc: 'OLEO DIESEL S10', qtd: '100.000', unit: '6.0000', total: '600.00' }) })
      .replace(/<nfeProc[^>]*>/, '')
      .replace('</nfeProc>', '');

    const n = lerNotaDeCombustivel(semEnvelope);
    expect(n.litrosDeCombustivel).toBe('100.000');
  });

  it('nota antiga com dEmi tambem tem data lida', () => {
    const n = lerNotaDeCombustivel(nfe({ itens: item({ desc: 'DIESEL', qtd: '10.000', unit: '6.0000', total: '60.00' }), ide: '<nNF>9</nNF><dEmi>2026-07-01</dEmi>' }));
    expect(n.emitidaEm?.toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('sem CNPJ do emitente, pede escolha manual do fornecedor', () => {
    const n = lerNotaDeCombustivel(nfe({ itens: item({ desc: 'DIESEL', qtd: '10.000', unit: '6.0000', total: '60.00' }), emit: '<xNome>SEM CNPJ LTDA</xNome>' }));
    expect(n.fornecedor.cnpj).toBeNull();
    expect(n.avisos.some((a) => a.includes('CNPJ'))).toBe(true);
  });

  it('arquivo que nao e NF-e falha com mensagem clara', () => {
    expect(() => lerNotaDeCombustivel('<xml><algo/></xml>')).toThrow(/nao parece uma NF-e/);
  });

  it('XML quebrado nao passa por valido', () => {
    expect(() => lerNotaDeCombustivel('isto nao e xml <<<')).toThrow();
  });
});
