/* Mapa da área em imagem PNG: estratos do KML, parcelas numeradas e pontos,
   com título, legenda, escala gráfica, norte e grade UTM. Feito no aparelho, sem internet. */
(function (root) {
  'use strict';
  const CORES = ['#66bb6a', '#ffca28', '#42a5f5', '#ef5350', '#ab47bc', '#26c6da', '#ff7043', '#8d6e63', '#d4e157', '#ec407a'];
  const PONTO = { arvore: ['#c62828', 'Árvore marcada'], planejado: ['#1565c0', 'Ponto planejado'], outro: ['#f9a825', 'Outro ponto'] };
  const fmt = (v, d = 2) => (+v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const passoBonito = alvo => { const p = 10 ** Math.floor(Math.log10(alvo)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= alvo); };
  const ok = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);

  /* proj, parcelas, pontos, opcoes {resultados: {porParcela}} → Promise<Blob PNG> */
  function gerar(proj, parcelas, pontos) {
    const ref = (proj.estratos || []).find(e => e.coords?.length)?.coords[0] || parcelas.flatMap(p => p.vertices).find(ok) || pontos.find(ok);
    if (!ref) throw new Error('Nada para desenhar: importe o KML das áreas ou marque parcelas e pontos.');
    const z = proj.zonaUTM || Geo.zonaDe(ref.lon), sul = ref.lat < 0;
    const U = c => Geo.paraUTM(c.lat, c.lon, z);

    const estr = (proj.estratos || []).map((e, i) => ({ ...e, cor: CORES[i % CORES.length], u: e.coords?.length >= 3 ? e.coords.filter(ok).map(U) : null }));
    const parc = parcelas.map(pc => {
      const v = App.verticesOrdenados(proj, pc).filter(ok).map(U);
      return v.length ? { pc, v, c: Geo.centro(v) } : null;
    }).filter(Boolean);
    const semGPS = parcelas.length - parc.length;
    const pts = pontos.filter(ok).map(p => ({ p, u: U(p) }));

    const todos = [...estr.flatMap(e => e.u || []), ...parc.flatMap(p => p.v), ...pts.map(p => p.u)];
    let minE = Math.min(...todos.map(p => p.E)), maxE = Math.max(...todos.map(p => p.E));
    let minN = Math.min(...todos.map(p => p.N)), maxN = Math.max(...todos.map(p => p.N));
    const lado = Math.max(maxE - minE, maxN - minN, 100), folga = lado * 0.06;
    minE -= folga; maxE += folga; minN -= folga; maxN += folga;

    // ---- página: mapa à esquerda, legenda à direita
    const M = 110, LEG = 520, TOP = 170;
    const esc = Math.min(1700 / (maxE - minE), 1500 / (maxN - minN));
    const mapW = (maxE - minE) * esc, mapH = (maxN - minN) * esc;
    const W = Math.max(M + mapW + 70 + LEG + 40, 1500);
    const H = Math.max(TOP + mapH + 120, 1150);
    const ox = M, oy = TOP;
    const X = u => ox + (u.E - minE) * esc, Y = u => oy + (maxN - u.N) * esc;

    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    const fonte = (px, peso = 400) => { g.font = `${peso} ${px}px system-ui, Roboto, "Segoe UI", sans-serif`; };
    const texto = (t, x, y, px, cor = '#1d241e', peso = 400, al = 'left', halo = false) => {
      fonte(px, peso); g.textAlign = al;
      if (halo) { g.lineWidth = px / 4; g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineJoin = 'round'; g.strokeText(t, x, y); }
      g.fillStyle = cor; g.fillText(t, x, y);
    };

    // ---- rótulos sem sobreposição: cada rótulo tenta 4 posições e é pulado (ou forçado) se não couber
    const ocupado = [];
    const bate = r => ocupado.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
    const obstaculo = (x, y, raio) => ocupado.push({ x: x - raio, y: y - raio, w: 2 * raio, h: 2 * raio });
    function rotulo(t, x, y, px, cor, peso, raio, forcar) {
      fonte(px, peso); const w = g.measureText(t).width, h = px * 1.15, d = raio + 6;
      const opcoes = [[x + d, y - h / 2], [x - d - w, y - h / 2], [x - w / 2, y - d - h], [x - w / 2, y + d]];
      let r = opcoes.map(([a, b]) => ({ x: a, y: b, w, h })).find(r => !bate(r) && r.x > ox && r.x + r.w < ox + mapW && r.y > oy && r.y + r.h < oy + mapH);
      if (!r) { if (!forcar) return false; r = { x: opcoes[0][0], y: opcoes[0][1], w, h }; }
      ocupado.push(r); texto(t, r.x, r.y + h / 2, px, cor, peso, 'left', true); return true;
    }

    // ---- título
    texto(proj.nome, M, 62, 50, '#2e5d34', 700);
    const tipo = proj.tipo === 'eucalipto' ? 'Reflorestamento (eucalipto)' : 'Cerrado nativo';
    const areaTot = estr.reduce((s, e) => s + (+e.areaHa || 0), 0) || +proj.areaHa || 0;
    texto(`${tipo} · ${parcelas.length} parcela${parcelas.length === 1 ? '' : 's'}${areaTot ? ` · ${fmt(areaTot)} ha` : ''} · ${new Date().toLocaleDateString('pt-BR')}`, M, 118, 30, '#66705f');

    // ---- moldura e grade UTM
    g.save(); g.beginPath(); g.rect(ox, oy, mapW, mapH); g.clip();
    g.fillStyle = '#f7f5ee'; g.fillRect(ox, oy, mapW, mapH);
    const passo = passoBonito((maxE - minE) / 5);
    g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 1.5;
    for (let e = Math.ceil(minE / passo) * passo; e <= maxE; e += passo) { g.beginPath(); g.moveTo(X({ E: e }), oy); g.lineTo(X({ E: e }), oy + mapH); g.stroke(); }
    for (let n = Math.ceil(minN / passo) * passo; n <= maxN; n += passo) { g.beginPath(); g.moveTo(ox, Y({ N: n })); g.lineTo(ox + mapW, Y({ N: n })); g.stroke(); }

    // ---- estratos
    const caminho = u => { g.beginPath(); u.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.closePath(); };
    estr.filter(e => e.u).forEach(e => {
      caminho(e.u); g.fillStyle = e.cor + '55'; g.fill(); g.strokeStyle = e.cor; g.lineWidth = 5; g.stroke();
    });
    // marcadores entram primeiro como obstáculos, para nenhum rótulo cobri-los
    parc.forEach(({ c }) => obstaculo(X(c), Y(c), 19)); pts.forEach(({ u }) => obstaculo(X(u), Y(u), 12));
    const rotEstr = [];
    estr.filter(e => e.u).forEach(e => {
      const c = Geo.centro(e.u), xs = e.u.map(X), ys = e.u.map(Y);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      fonte(34, 700); const w = Math.max(g.measureText(e.nome).width, 120);
      if (bw > w * 1.1 && bh > 100) rotEstr.push({ e, x: X(c), y: Y(c), w, bh, poly: e.u.map(p => ({ E: X(p), N: Y(p) })) });
    });

    // ---- parcelas (polígono quando há 3+ vértices; marcador numerado sempre)
    parc.forEach(({ v }) => { if (v.length >= 3) { caminho(v); g.fillStyle = 'rgba(239,108,0,.35)'; g.fill(); g.strokeStyle = '#e65100'; g.lineWidth = 3; g.stroke(); } });
    const rP = 17;
    parc.forEach(({ pc, c }) => {
      g.beginPath(); g.arc(X(c), Y(c), rP, 0, 2 * Math.PI); g.fillStyle = pc.excluir ? '#9e9e9e' : '#e65100'; g.fill();
      g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    });

    // ---- pontos
    pts.forEach(({ p, u }) => {
      const cor = (PONTO[p.tipo] || PONTO.outro)[0];
      g.beginPath();
      if (p.tipo === 'planejado') { g.moveTo(X(u), Y(u) - 14); g.lineTo(X(u) + 12, Y(u) + 9); g.lineTo(X(u) - 12, Y(u) + 9); g.closePath(); }
      else g.arc(X(u), Y(u), 10, 0, 2 * Math.PI);
      g.fillStyle = cor; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    });
    // prioridade dos rótulos: número da parcela > nome do estrato > nome do ponto
    parc.forEach(({ pc, c }) => rotulo(pc.numero, X(c), Y(c), 30, '#bf360c', 700, rP, true));
    rotEstr.forEach(({ e, x, y: y0, w, bh, poly }) => {
      // tenta o centro e depois posições acima/abaixo dele, sempre dentro do polígono
      const y = [0, -.3, .3, -.15, .15, -.4, .4].map(f => y0 + f * bh)
        .find(yy => Geo.dentro({ E: x, N: yy }, poly) && !bate({ x: x - w / 2, y: yy - 40, w, h: 80 }));
      if (y == null) return; ocupado.push({ x: x - w / 2, y: y - 40, w, h: 80 });
      texto(e.nome, x, y - 18, 34, '#1b3d20', 700, 'center', true); texto(`${fmt(+e.areaHa || 0)} ha`, x, y + 20, 28, '#1b3d20', 400, 'center', true);
    });
    let semRotulo = 0;
    pts.forEach(({ p, u }) => { const n = p.especie || p.nome; if (n && !rotulo(n, X(u), Y(u), 22, '#37474f', 400, 12, false)) semRotulo++; });
    g.restore();

    // ---- moldura, rótulos da grade
    g.strokeStyle = '#37474f'; g.lineWidth = 3; g.strokeRect(ox, oy, mapW, mapH);
    for (let e = Math.ceil(minE / passo) * passo; e <= maxE; e += passo) texto(`${fmt(e, 0)} E`, X({ E: e }), oy + mapH + 26, 22, '#555', 400, 'center');
    g.save();
    for (let n = Math.ceil(minN / passo) * passo; n <= maxN; n += passo) {
      g.translate(ox - 26, Y({ N: n })); g.rotate(-Math.PI / 2); texto(`${fmt(n, 0)} N`, 0, 0, 22, '#555', 400, 'center'); g.setTransform(1, 0, 0, 1, 0, 0);
    }
    g.restore();

    // ---- norte
    const nx = ox + mapW - 60, ny = oy + 110;
    g.beginPath(); g.moveTo(nx, ny - 50); g.lineTo(nx + 22, ny + 20); g.lineTo(nx, ny + 6); g.lineTo(nx - 22, ny + 20); g.closePath();
    g.fillStyle = '#1d241e'; g.fill(); texto('N', nx, ny - 72, 34, '#1d241e', 700, 'center', true);

    // ---- escala gráfica
    const comp = passoBonito((maxE - minE) / 4), px = comp * esc, sx = ox + 30, sy = oy + mapH - 50;
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(sx - 16, sy - 46, px + 32, 80);
    [0, 1, 2, 3].forEach(i => { g.fillStyle = i % 2 ? '#fff' : '#1d241e'; g.fillRect(sx + i * px / 4, sy, px / 4, 12); });
    g.strokeStyle = '#1d241e'; g.lineWidth = 2; g.strokeRect(sx, sy, px, 12);
    texto('0', sx, sy - 18, 22, '#1d241e', 400, 'center');
    texto(comp >= 1000 ? `${fmt(comp / 1000, comp % 1000 ? 1 : 0)} km` : `${fmt(comp, 0)} m`, sx + px, sy - 18, 22, '#1d241e', 400, 'center');

    // ---- legenda
    const lx = ox + mapW + 70; let ly = TOP + 10;
    texto('Legenda', lx, ly, 34, '#1d241e', 700); ly += 56;
    if (estr.length) {
      texto('Estratos', lx, ly, 26, '#66705f', 700); ly += 42;
      estr.forEach(e => {
        g.fillStyle = e.cor + '88'; g.fillRect(lx, ly - 16, 44, 32); g.strokeStyle = e.cor; g.lineWidth = 4; g.strokeRect(lx, ly - 16, 44, 32);
        texto(`${e.nome}`, lx + 60, ly - 8, 25, '#1d241e', 600); texto(`${fmt(+e.areaHa || 0)} ha${e.u ? '' : ' (sem polígono)'}`, lx + 60, ly + 20, 22, '#66705f');
        ly += 66;
      });
      ly += 6;
    }
    texto('Parcelas', lx, ly, 26, '#66705f', 700); ly += 42;
    g.beginPath(); g.arc(lx + 22, ly, rP, 0, 2 * Math.PI); g.fillStyle = '#e65100'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    texto(`Parcela (${parc.length} com GPS)`, lx + 60, ly, 25); ly += 48;
    if (parc.some(p => p.v.length >= 3)) { g.fillStyle = 'rgba(239,108,0,.35)'; g.fillRect(lx, ly - 14, 44, 28); g.strokeStyle = '#e65100'; g.lineWidth = 3; g.strokeRect(lx, ly - 14, 44, 28); texto('Contorno pelos vértices', lx + 60, ly, 25); ly += 48; }
    if (parc.some(p => p.pc.excluir)) { g.beginPath(); g.arc(lx + 22, ly, rP, 0, 2 * Math.PI); g.fillStyle = '#9e9e9e'; g.fill(); texto('Fora do cálculo', lx + 60, ly, 25); ly += 48; }
    if (semGPS) { texto(`${semGPS} parcela${semGPS > 1 ? 's' : ''} sem GPS (não aparece${semGPS > 1 ? 'm' : ''})`, lx, ly, 22, '#b3261e'); ly += 40; }
    const tipos = [...new Set(pts.map(p => p.p.tipo))];
    if (tipos.length) {
      ly += 6; texto('Pontos', lx, ly, 26, '#66705f', 700); ly += 42;
      tipos.forEach(t => {
        const [cor, nome] = PONTO[t] || PONTO.outro;
        g.beginPath();
        if (t === 'planejado') { g.moveTo(lx + 22, ly - 14); g.lineTo(lx + 34, ly + 9); g.lineTo(lx + 10, ly + 9); g.closePath(); } else g.arc(lx + 22, ly, 10, 0, 2 * Math.PI);
        g.fillStyle = cor; g.fill();
        texto(`${nome} (${pts.filter(p => p.p.tipo === t).length})`, lx + 60, ly, 25); ly += 46;
      });
    }
    ly += 20;
    texto('Coordenadas UTM', lx, ly, 22, '#66705f', 700); ly += 32;
    texto(`SIRGAS 2000 · zona ${z}${sul ? 'S' : 'N'}`, lx, ly, 22, '#66705f'); ly += 32;
    texto(`Grade de ${fmt(passo, 0)} m`, lx, ly, 22, '#66705f');

    if (semRotulo) { ly += 40; texto(`${semRotulo} ponto${semRotulo > 1 ? 's' : ''} sem nome no mapa`, lx, ly, 20, '#9aa595'); ly += 28; texto('(muito próximos; nomes na planilha)', lx, ly, 20, '#9aa595'); }
    texto('Gerado pelo app Inventário Florestal', W - 40, H - 36, 20, '#9aa595', 400, 'right');
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  root.MapaPNG = { gerar };
})(window);
