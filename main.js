// ── CONSTANTS ────────────────────────────────────────────────────────────────

const REGION_COLORS = {
  'Arctic':          '#ff4d6d',
  'N. Temperate':    '#f4a261',
  'Tropical':        '#90e0ef',
  'S. Temperate':    '#48cae4',
  'Southern Ocean':  '#0077b6',
};

const REGION_ORDER = ['Arctic', 'N. Temperate', 'Tropical', 'S. Temperate', 'Southern Ocean'];

function getBasin(lat) {
  if (lat > 60)  return 'Arctic';
  if (lat > 30)  return 'N. Temperate';
  if (lat > -30) return 'Tropical';
  if (lat > -60) return 'S. Temperate';
  return 'Southern Ocean';
}

const tooltip = document.getElementById('tooltip');

function showTooltip(event, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('show');
  moveTooltip(event);
}

function moveTooltip(event) {
  tooltip.style.left = (event.clientX + 16) + 'px';
  tooltip.style.top  = (event.clientY - 10) + 'px';
}

function hideTooltip() {
  tooltip.classList.remove('show');
}

// ── HERO CANVAS ───────────────────────────────────────────────────────────────

function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  let t = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;
    for (let i = 0; i < 6; i++) {
      const amp   = 18 + i * 10;
      const freq  = 0.007 - i * 0.0008;
      const speed = 0.35 + i * 0.12;
      const yBase = H * (0.25 + i * 0.11);
      const alpha = 0.07 - i * 0.009;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let px = 0; px <= W; px += 5) {
        ctx.lineTo(px, yBase + amp * Math.sin(px * freq + t * speed));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = `rgba(0,180,216,${alpha})`;
      ctx.fill();
    }
    t += 0.018;
    requestAnimationFrame(draw);
  }
  draw();

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

initHeroCanvas();

// ── DATA LOAD ─────────────────────────────────────────────────────────────────

Promise.all([
  d3.csv('annual_mean_surface_ph_peryear_1850_2014.csv', d => ({
    year: +d.time.slice(0, 4),
    lat:  +d.lat_5deg,
    lon:  +d.lon_5deg,
    ph:   +d.ph,
  })),
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'),
]).then(([data, worldTopo]) => {

  // ── GLOBAL TREND ──────────────────────────────────────────────────────────
  const globalByYear = Array.from(
    d3.rollup(data, v => d3.mean(v, d => d.ph), d => d.year),
    ([year, ph]) => ({ year, ph })
  ).sort((a, b) => a.year - b.year);

  // ── REGIONAL TRENDS ───────────────────────────────────────────────────────
  const regionalMap = d3.rollup(
    data,
    v => d3.mean(v, d => d.ph),
    d => getBasin(d.lat),
    d => d.year
  );

  const regionalSeries = REGION_ORDER.map(basin => ({
    basin,
    values: Array.from(regionalMap.get(basin) || [], ([year, ph]) => ({ year, ph }))
              .sort((a, b) => a.year - b.year),
  }));

  // ── DELTA MAP DATA ────────────────────────────────────────────────────────
  const byCell = d3.group(data, d => `${d.lat},${d.lon}`);
  const deltaData = Array.from(byCell, ([key, rows]) => {
    const r1850 = rows.find(r => r.year === 1850);
    const r2014 = rows.find(r => r.year === 2014);
    if (!r1850 || !r2014) return null;
    const [lat, lon] = key.split(',').map(Number);
    return { lat, lon, delta: r2014.ph - r1850.ph, ph1850: r1850.ph, ph2014: r2014.ph };
  }).filter(Boolean);

  renderGlobalTrend(globalByYear);
  renderRegionalChart(regionalSeries);
  renderDeltaMap(deltaData, worldTopo);
  setupObserver();
});

// ── VIZ 1: GLOBAL TREND ───────────────────────────────────────────────────────

function renderGlobalTrend(data) {
  const el    = document.getElementById('viz-trend');
  const W     = el.clientWidth || 560;
  const m     = { top: 24, right: 24, bottom: 44, left: 58 };
  const iW    = W - m.left - m.right;
  const iH    = 320 - m.top - m.bottom;

  const svg = d3.select('#viz-trend').append('svg')
    .attr('width', W).attr('height', iH + m.top + m.bottom)
    .attr('class', 'viz-svg')
    .append('g').attr('transform', `translate(${m.left},${m.top})`);

  const x = d3.scaleLinear().domain([1850, 2014]).range([0, iW]);
  const [yMin, yMax] = d3.extent(data, d => d.ph);
  const y = d3.scaleLinear().domain([yMin - 0.005, yMax + 0.008]).range([iH, 0]);

  // Grid
  svg.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
    .selectAll('.tick line').attr('stroke', '#0e2a3d').attr('stroke-dasharray', '3,4');
  svg.select('.domain').remove();

  // Axes
  svg.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });

  svg.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.3f')))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });

  svg.append('text').attr('transform','rotate(-90)').attr('x',-iH/2).attr('y',-m.left+14)
    .attr('text-anchor','middle').attr('fill','#7fb3c8').style('font-size','11px').text('Sea Surface pH');

  // 1850 baseline
  const baseline1850 = data[0].ph;
  svg.append('line')
    .attr('x1', 0).attr('x2', iW)
    .attr('y1', y(baseline1850)).attr('y2', y(baseline1850))
    .attr('stroke', '#f4a261').attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.8);
  svg.append('text')
    .attr('x', iW - 4).attr('y', y(baseline1850) - 7)
    .attr('text-anchor', 'end').attr('fill', '#f4a261').style('font-size', '11px')
    .text(`1850 baseline (${baseline1850.toFixed(3)})`);

  // Deficit shading
  const deficitShading = svg.append('path').datum(data)
    .attr('fill', '#ff4d6d').attr('opacity', 0.1)
    .attr('d', d3.area().x(d => x(d.year)).y0(y(baseline1850)).y1(d => y(d.ph)).curve(d3.curveCatmullRom));

  const toggleBtn = document.getElementById('btn-toggle-shading');
  let shadingVisible = true;
  toggleBtn.addEventListener('click', () => {
    shadingVisible = !shadingVisible;
    deficitShading.attr('opacity', shadingVisible ? 0.1 : 0);
    toggleBtn.textContent = shadingVisible ? 'Hide Acidification Deficit' : 'Show Acidification Deficit';
  });

  // Main line — animated
  const linePath = svg.append('path').datum(data)
    .attr('fill', 'none').attr('stroke', '#00b4d8').attr('stroke-width', 2.5)
    .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom));

  const len = linePath.node().getTotalLength();
  linePath.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);

  document.getElementById('section-trend')._animate = () => {
    linePath.transition().duration(2200).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);
  };

  // Dots + tooltip (every 5 years to avoid clutter)
  const sparse = data.filter(d => d.year % 5 === 0);
  svg.selectAll('.dot').data(sparse).enter().append('circle')
    .attr('cx', d => x(d.year)).attr('cy', d => y(d.ph))
    .attr('r', 4).attr('fill', '#00b4d8').attr('stroke', '#020d1a').attr('stroke-width', 2)
    .on('mouseover', (event, d) => showTooltip(event,
      `<strong>${d.year}</strong><br>pH: ${d.ph.toFixed(4)}<br><span style="color:#ff4d6d">Δ from 1850: ${(d.ph - data[0].ph).toFixed(4)}</span>`))
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip);
}

// ── VIZ 2: REGIONAL DIVERGENCE ────────────────────────────────────────────────

function renderRegionalChart(series) {
  const el = document.getElementById('viz-regional');
  const W  = el.clientWidth || 560;
  const m  = { top: 24, right: 110, bottom: 44, left: 58 };
  const iW = W - m.left - m.right;
  const iH = 340 - m.top - m.bottom;

  const svg = d3.select('#viz-regional').append('svg')
    .attr('width', W).attr('height', iH + m.top + m.bottom)
    .attr('class', 'viz-svg')
    .append('g').attr('transform', `translate(${m.left},${m.top})`);

  const allVals = series.flatMap(s => s.values);
  const x = d3.scaleLinear().domain([1850, 2014]).range([0, iW]);
  const y = d3.scaleLinear()
    .domain([d3.min(allVals, d => d.ph) - 0.005, d3.max(allVals, d => d.ph) + 0.008])
    .range([iH, 0]);

  // Grid
  svg.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
    .selectAll('.tick line').attr('stroke', '#0e2a3d').attr('stroke-dasharray', '3,4');
  svg.select('.domain').remove();

  // Axes
  svg.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });
  svg.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.3f')))
    .call(g => { g.select('.domain').attr('stroke','#0e2a3d'); g.selectAll('text').attr('fill','#7fb3c8'); });

  svg.append('text').attr('transform','rotate(-90)').attr('x',-iH/2).attr('y',-m.left+14)
    .attr('text-anchor','middle').attr('fill','#7fb3c8').style('font-size','11px').text('Sea Surface pH');

  const lineGen = d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom);

  // Draw lines (hidden, revealed on scroll)
  const paths = series.map(({ basin, values }) => {
    const path = svg.append('path')
      .datum(values)
      .attr('fill', 'none')
      .attr('stroke', REGION_COLORS[basin])
      .attr('stroke-width', 2.2)
      .attr('opacity', 0.9)
      .attr('d', lineGen);

    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);

    // Label at end of line
    const last = values[values.length - 1];
    svg.append('text')
      .attr('x', x(last.year) + 6)
      .attr('y', y(last.ph) + 4)
      .attr('fill', REGION_COLORS[basin])
      .style('font-size', '10px')
      .style('font-weight', '600')
      .text(basin);

    return path;
  });

  document.getElementById('section-regional')._animate = () => {
    paths.forEach((path, i) => {
      const len = +path.attr('stroke-dasharray').split(' ')[0];
      path.transition().delay(i * 180).duration(1800).ease(d3.easeCubicInOut)
        .attr('stroke-dashoffset', 0);
    });
  };
}

// ── VIZ 3: DELTA MAP ──────────────────────────────────────────────────────────

function renderDeltaMap(deltaData, worldTopo) {
  const container = document.getElementById('viz-map');
  const W = container.parentElement.clientWidth || window.innerWidth * 0.9;
  const H = Math.round(W * 0.48);

  const projection = d3.geoNaturalEarth1()
    .scale(W / 6.3)
    .translate([W / 2, H / 2]);

  const path = d3.geoPath().projection(projection);

  // Color scale: delta is negative (pH dropped), domain [minDelta, 0]
  const [minDelta] = d3.extent(deltaData, d => d.delta);
  const colorScale = d3.scaleSequential()
    .domain([minDelta, 0])
    .interpolator(d3.interpolateRgbBasis(['#ff4d6d', '#f4a261', '#fffde7', '#e2f0f7']));

  // SVG basemap
  const svg = d3.select('#viz-map').append('svg')
    .attr('width', W).attr('height', H)
    .style('position', 'absolute').style('top', 0).style('left', 0)
    .attr('class', 'viz-svg');

  svg.append('rect').attr('width', W).attr('height', H).attr('fill', '#010a14');

  svg.append('path')
    .datum(d3.geoGraticule().step([30, 30])())
    .attr('d', path).attr('fill', 'none')
    .attr('stroke', '#0a2540').attr('stroke-width', 0.5);

  svg.append('path')
    .datum(topojson.feature(worldTopo, worldTopo.objects.countries))
    .attr('d', path).attr('fill', '#0f1a24')
    .attr('stroke', '#1a3a52').attr('stroke-width', 0.4);

  // Canvas data layer
  const canvas = d3.select('#viz-map').append('canvas')
    .attr('width', W).attr('height', H)
    .style('position', 'absolute').style('top', 0).style('left', 0)
    .style('pointer-events', 'none');

  const ctx = canvas.node().getContext('2d');

  // Pre-project cell centers for quadtree + canvas
  const projected = deltaData.map(d => {
    const [px, py] = projection([d.lon, d.lat]) || [];
    return { ...d, px, py };
  }).filter(d => d.px != null && !isNaN(d.px));

  // Cell half-size in pixels (5° grid)
  const cellPx = Math.abs(projection([5, 0])[0] - projection([0, 0])[0]) * 0.9;

  function drawCells(alpha) {
    ctx.clearRect(0, 0, W, H);
    projected.forEach(d => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colorScale(d.delta);
      ctx.fillRect(d.px - cellPx / 2, d.py - cellPx / 2, cellPx, cellPx);
    });
    ctx.globalAlpha = 1;
  }

  document.getElementById('section-map')._animate = () => {
    let start = null;
    function frame(ts) {
      if (!start) start = ts;
      const t = Math.min((ts - start) / 900, 1);
      drawCells(t * 0.88);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  // Quadtree for tooltip
  const qt = d3.quadtree().x(d => d.px).y(d => d.py).addAll(projected);

  svg.append('rect').attr('width', W).attr('height', H)
    .attr('fill', 'none').attr('pointer-events', 'all')
    .on('mousemove', event => {
      const [mx, my] = d3.pointer(event);
      const nearest = qt.find(mx, my, 20);
      if (nearest) {
        showTooltip(event,
          `<strong>${nearest.lat}°, ${nearest.lon}°</strong><br>` +
          `1850 pH: ${nearest.ph1850.toFixed(4)}<br>` +
          `2014 pH: ${nearest.ph2014.toFixed(4)}<br>` +
          `<span style="color:#ff4d6d">Δ pH: ${nearest.delta.toFixed(4)}</span>`);
      }
    })
    .on('mouseleave', hideTooltip);

  // Container sizing
  d3.select('#viz-map').style('position', 'relative').style('height', H + 'px');

  // Legend
  renderMapLegend(minDelta, colorScale);
}

function renderMapLegend(minDelta, colorScale) {
  const lW = 220, lH = 14;
  const svg = d3.select('#legend-svg')
    .attr('width', lW + 8).attr('height', lH + 22);

  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'delta-grad');
  d3.range(0, 1.01, 0.05).forEach(t => {
    grad.append('stop')
      .attr('offset', `${t * 100}%`)
      .attr('stop-color', colorScale(minDelta + t * (0 - minDelta)));
  });

  svg.append('rect').attr('width', lW).attr('height', lH)
    .attr('rx', 3).attr('fill', 'url(#delta-grad)');

  svg.append('text').attr('x', 0).attr('y', lH + 14)
    .attr('fill', '#7fb3c8').style('font-size', '10px')
    .text(minDelta.toFixed(3));

  svg.append('text').attr('x', lW).attr('y', lH + 14)
    .attr('text-anchor', 'end').attr('fill', '#7fb3c8').style('font-size', '10px')
    .text('0.000');
}

// ── SCROLL OBSERVER ───────────────────────────────────────────────────────────

function setupObserver() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add('visible');

      if (el.id === 'section-trend' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 300);
      }
      if (el.id === 'section-regional' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 200);
      }
      if (el.id === 'section-map' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 150);
      }
      if (el.id === 'section-stakes' && !el._done) {
        el._done = true;
        document.querySelectorAll('.stake-card').forEach((card, i) => {
          setTimeout(() => card.classList.add('visible'), i * 160);
        });
      }

      observer.unobserve(el);
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
}
