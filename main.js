// ── CONSTANTS ────────────────────────────────────────────────────────────────

const REGION_COLORS = {
  'Arctic':          '#ff4d6d',
  'N. Temperate':    '#f4a261',
  'Tropical':        '#90e0ef',
  'S. Temperate':    '#48cae4',
  'Southern Ocean':  '#0077b6',
  'Bering Sea':      '#ff6b00',
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


// Shared interaction state. The regional line chart can call this after the map exists.
let updateMapRegionFocus = null;
let lastMapAlpha = 0.76;

function focusMapRegion(basin) {
  if (typeof updateMapRegionFocus === 'function') updateMapRegionFocus(basin);
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

  const beringCells = data.filter(d => d.lat >= 55 && d.lat <= 65 && d.lon <= -155);
  const beringByYear = Array.from(
    d3.rollup(beringCells, v => d3.mean(v, d => d.ph), d => d.year),
    ([year, ph]) => ({ year, ph })
  ).sort((a, b) => a.year - b.year);
  const beringSeries = { basin: 'Bering Sea', values: beringByYear };
  const allSeries = [...regionalSeries, beringSeries];

  renderGlobalTrend(globalByYear);
  renderRegionalChart(allSeries);
  renderAcidificationGuess(allSeries);
  renderDeltaMap(deltaData, worldTopo, regionalMap, data);
  renderBeringChart(data, globalByYear);
  renderEcologicalDomino();
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
  svg.append('path').datum(data)
    .attr('fill', '#ff4d6d').attr('opacity', 0.1)
    .attr('d', d3.area().x(d => x(d.year)).y0(y(baseline1850)).y1(d => y(d.ph)).curve(d3.curveCatmullRom));


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

// ── VIZ 1b: BERING SEA SPOTLIGHT ─────────────────────────────────────────────

function renderBeringChart(rawData, globalByYear) {
  const beringCells = rawData.filter(d => d.lat >= 55 && d.lat <= 65 && d.lon <= -155);
  const beringByYear = Array.from(
    d3.rollup(beringCells, v => d3.mean(v, d => d.ph), d => d.year),
    ([year, ph]) => ({ year, ph })
  ).sort((a, b) => a.year - b.year);

  if (!beringByYear.length) return;

  const el = document.getElementById('viz-bering');
  const W  = el.clientWidth || 560;
  const m  = { top: 28, right: 24, bottom: 44, left: 58 };
  const iW = W - m.left - m.right;
  const iH = 300 - m.top - m.bottom;

  const svg = d3.select('#viz-bering').append('svg')
    .attr('width', W).attr('height', iH + m.top + m.bottom)
    .attr('class', 'viz-svg')
    .append('g').attr('transform', `translate(${m.left},${m.top})`);

  const allPh = [...beringByYear, ...globalByYear].map(d => d.ph);
  const x = d3.scaleLinear().domain([1850, 2014]).range([0, iW]);
  const y = d3.scaleLinear().domain([d3.min(allPh) - 0.005, d3.max(allPh) + 0.008]).range([iH, 0]);

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
  const baseline1850 = beringByYear[0].ph;
  svg.append('line')
    .attr('x1', 0).attr('x2', iW)
    .attr('y1', y(baseline1850)).attr('y2', y(baseline1850))
    .attr('stroke', '#f4a261').attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.8);
  svg.append('text')
    .attr('x', iW - 4).attr('y', y(baseline1850) - 7)
    .attr('text-anchor', 'end').attr('fill', '#f4a261').style('font-size', '11px')
    .text(`1850 baseline (${baseline1850.toFixed(3)})`);

  // Global mean reference line
  svg.append('path').datum(globalByYear)
    .attr('fill', 'none').attr('stroke', '#7fb3c8').attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5,4').attr('opacity', 0.4)
    .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom));
  svg.append('text')
    .attr('x', 6)
    .attr('y', y(globalByYear[0].ph) + 14)
    .attr('fill', '#7fb3c8').style('font-size', '10px').attr('opacity', 0.6)
    .text('Global mean');

  // Annotation ticks
  const annotations = [
    { year: 1950, label: 'Post-war growth' },
    { year: 1984, label: 'Rapid acceleration' },
    { year: 2014, label: '−0.15 from 1850' },
  ];
  const byYearMap = new Map(beringByYear.map(d => [d.year, d.ph]));
  annotations.forEach(({ year, label }) => {
    const cx = x(year);
    const ph = byYearMap.get(year);
    if (ph == null) return;
    svg.append('line')
      .attr('x1', cx).attr('x2', cx)
      .attr('y1', y(ph) - 4).attr('y2', iH)
      .attr('stroke', '#ff4d6d').attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3').attr('opacity', 0.45);
    svg.append('text')
      .attr('x', year === 2014 ? cx - 30 : year === 1984 ? cx + 2 : cx - 20)
      .attr('y', year === 1984 ? Math.max(12, y(ph) - 10) : Math.max(12, y(ph) - 8))
      .attr('text-anchor', year === 2014 ? 'end' : 'start')
      .attr('fill', '#ff4d6d').style('font-size', '9px')
      .text(label);
  });

  // Bering Sea line — animated on scroll
  const linePath = svg.append('path').datum(beringByYear)
    .attr('fill', 'none').attr('stroke', '#00b4d8').attr('stroke-width', 2.5)
    .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom));

  const len = linePath.node().getTotalLength();
  linePath.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);

  // Deficit shading
  svg.append('path').datum(beringByYear)
    .attr('fill', '#ff4d6d').attr('opacity', 0.08)
    .attr('d', d3.area().x(d => x(d.year)).y0(y(baseline1850)).y1(d => y(d.ph)).curve(d3.curveCatmullRom));

  document.getElementById('section-human')._animate = () => {
    linePath.transition().duration(2200).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);
  };
}

// ── VIZ 2: REGIONAL DIVERGENCE ────────────────────────────────────────────────

function renderRegionalChart(series) {
  const el = document.getElementById('viz-regional');
  const W  = el.clientWidth || 560;
  const m  = { top: 24, right: 150, bottom: 44, left: 58 };
  const iW = W - m.left - m.right;
  const iH = 440 - m.top - m.bottom;

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

  svg.append('text')
    .attr('x', 0)
    .attr('y', -9)
    .attr('fill', '#7fb3c8')
    .attr('opacity', 0.85)
    .style('font-size', '10px')
    .text('Hover a region line or label to highlight the matching latitude band on the map.');

  const lineGen = d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom);
  const labelX = iW + 16;
  const minLabelGap = 16;

  function spreadLabels(labels) {
    const sorted = labels.slice().sort((a, b) => a.y - b.y);
    sorted.forEach((d, i) => {
      d.labelY = i === 0 ? d.y : Math.max(d.y, sorted[i - 1].labelY + minLabelGap);
    });
    const overflow = sorted.length ? sorted[sorted.length - 1].labelY - (iH - 4) : 0;
    if (overflow > 0) sorted.forEach(d => d.labelY -= overflow);
    sorted.forEach((d, i) => {
      d.labelY = i === 0 ? Math.max(4, d.labelY) : Math.max(d.labelY, sorted[i - 1].labelY + minLabelGap);
    });
    return sorted;
  }

  function showRegionTooltip(event, d) {
    const first = d.values[0];
    const last = d.values[d.values.length - 1];
    showTooltip(event,
      `<strong>${d.basin}</strong><br>` +
      `1850 pH: ${first.ph.toFixed(4)}<br>` +
      `2014 pH: ${last.ph.toFixed(4)}<br>` +
      `<span style="color:#ff4d6d">Δ pH: ${(last.ph - first.ph).toFixed(4)}</span>`);
  }

  function focusRegionalChart(basin) {
    svg.selectAll('.regional-line')
      .attr('opacity', d => {
        if (!basin) return d.basin === 'Bering Sea' ? 1.0 : 0.38;
        return d.basin === basin ? 1 : 0.16;
      })
      .attr('stroke-width', d => basin && d.basin === basin ? 3.3 : (d.basin === 'Bering Sea' ? 2.8 : 2.2));

    svg.selectAll('.regional-label, .regional-label-line')
      .attr('opacity', d => !basin || d.basin === basin ? 1 : 0.18);
  }

  const labelData = [];

  // Draw lines (hidden, revealed on scroll)
  const paths = series.map(({ basin, values }) => {
    const path = svg.append('path')
      .datum({ basin, values })
      .attr('class', 'regional-line')
      .attr('fill', 'none')
      .attr('stroke', REGION_COLORS[basin])
      .attr('stroke-width', basin === 'Bering Sea' ? 2.8 : 2.2)
      .attr('opacity', basin === 'Bering Sea' ? 1.0 : 0.38)
      .attr('d', d => lineGen(d.values))
      .on('mouseover', (event, d) => {
        focusRegionalChart(d.basin);
        focusMapRegion(d.basin);
        showRegionTooltip(event, d);
      })
      .on('mousemove', (event, d) => showRegionTooltip(event, d))
      .on('mouseout', () => {
        focusRegionalChart(null);
        focusMapRegion(null);
        hideTooltip();
      });

    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len);

    const last = values[values.length - 1];
    labelData.push({ basin, values, x: x(last.year), y: y(last.ph), ph: last.ph });

    return path;
  });

  // End labels: spread vertically to avoid overlap, with connector lines back to each series.
  const placedLabels = spreadLabels(labelData);

  svg.selectAll('.regional-label-line')
    .data(placedLabels)
    .enter()
    .append('line')
    .attr('class', 'regional-label-line')
    .attr('x1', d => d.x + 3)
    .attr('x2', labelX - 5)
    .attr('y1', d => d.y)
    .attr('y2', d => d.labelY)
    .attr('stroke', d => REGION_COLORS[d.basin])
    .attr('stroke-width', 1)
    .attr('opacity', 0.45);

  svg.selectAll('.regional-label')
    .data(placedLabels)
    .enter()
    .append('text')
    .attr('class', 'regional-label')
    .attr('x', labelX)
    .attr('y', d => d.labelY + 4)
    .attr('fill', d => REGION_COLORS[d.basin])
    .style('font-size', '10px')
    .style('font-weight', '600')
    .style('cursor', 'default')
    .text(d => d.basin)
    .on('mouseover', (event, d) => {
      focusRegionalChart(d.basin);
      focusMapRegion(d.basin);
      showRegionTooltip(event, d);
    })
    .on('mousemove', (event, d) => showRegionTooltip(event, d))
    .on('mouseout', () => {
      focusRegionalChart(null);
      focusMapRegion(null);
      hideTooltip();
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

function renderDeltaMap(deltaData, worldTopo, regionalMap, rawData) {
  const sortedDeltas = deltaData.map(d => d.delta).sort((a, b) => a - b);
  const stretchedMin = d3.quantile(sortedDeltas, 0.03);
  const bandColorScale = d3.scaleSequential()
    .domain([0, stretchedMin])
    .interpolator(t => d3.interpolateRdYlBu((1 - t) * 0.78))
    .clamp(true);

  const sliderEl = document.getElementById('map-year-slider');
  const yearReadout = d3.select('#map-year-readout');

  const cellYearPH = new Map();
  rawData.forEach(d => {
    const key = `${d.lat},${d.lon}`;
    if (!cellYearPH.has(key)) cellYearPH.set(key, new Map());
    cellYearPH.get(key).set(d.year, d.ph);
  });

  // ── Bering Sea: cold high-latitude focus ───────────────────────────────────
  const beringEl = document.getElementById('viz-map-bering');
  const W1 = beringEl.clientWidth || 500;
  const H1 = Math.round(W1 * 0.80);
  const beringProj = d3.geoMercator()
    .center([-168, 58])
    .scale(W1 * 1.55)
    .translate([W1 / 2, Math.round(W1 * 0.36)]);
  const bering = buildMapPanel('#viz-map-bering', W1, H1, beringProj, deltaData, cellYearPH, worldTopo);

  // ── Philippine Sea: tropical near-landmass focus ───────────────────────────
  const philEl = document.getElementById('viz-map-phil');
  const W2 = philEl.clientWidth || 500;
  const H2 = Math.round(W2 * 0.80);
  const philProj = d3.geoMercator()
    .center([125, 12])
    .scale(W2 * 2.2)
    .translate([W2 / 2, H2 / 2]);
  const phil = buildMapPanel('#viz-map-phil', W2, H2, philProj, deltaData, cellYearPH, worldTopo);

  function updateBoth(year) {
    [bering, phil].forEach(({ dots }) => {
      dots.attr('fill', d => {
        const ph1850 = cellYearPH.get(d.key)?.get(1850);
        const phYear = cellYearPH.get(d.key)?.get(year);
        return (ph1850 != null && phYear != null) ? bandColorScale(phYear - ph1850) : '#334';
      });
    });
    yearReadout.text(year);
    const pct = ((year - 1850) / (2014 - 1850)) * 100;
    sliderEl.style.background = `linear-gradient(to right, var(--teal) ${pct}%, #0e2a3d ${pct}%)`;
  }

  updateMapRegionFocus = basin => {
    [bering, phil].forEach(({ dots, dotR }) => {
      dots
        .attr('opacity', d => !basin || d.basin === basin ? 0.90 : 0.12)
        .attr('r', d => !basin ? dotR : (d.basin === basin ? dotR * 1.25 : dotR * 0.85));
    });
  };

  sliderEl.addEventListener('input', () => updateBoth(+sliderEl.value));
  updateBoth(1850);

  // Add play button
const playBtn = d3.select('#map-year-control')
  .insert('button', 'input')
  .attr('id', 'map-play-btn')
  .style('margin-right', '10px')
  .style('background', '#0a2540')
  .style('color', '#00b4d8')
  .style('border', '1px solid #00b4d8')
  .style('border-radius', '4px')
  .style('padding', '4px 10px')
  .style('cursor', 'pointer')
  .text('▶ Play');

let playInterval = null;
playBtn.on('click', () => {
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
    playBtn.text('▶ Play');
  } else {
    if (+sliderEl.value >= 2014) sliderEl.value = 1850;
    playBtn.text('⏸ Pause');
    playInterval = setInterval(() => {
      const v = +sliderEl.value + 1;
      if (v > 2014) { clearInterval(playInterval); playInterval = null; playBtn.text('▶ Play'); return; }
      sliderEl.value = v;
      updateBoth(v);
    }, 40);
  }
});

  document.getElementById('section-map')._animate = () => {
    [bering, phil].forEach(({ dots }) => {
      dots.attr('opacity', 0)
        .transition().duration(900)
        .delay((_, i) => i * 2)
        .attr('opacity', 0.88);
    });
  };

  renderMapLegend(0, stretchedMin, bandColorScale);
  renderMapNotes();
}

function buildMapPanel(selector, W, H, projection, deltaData, cellYearPH, worldTopo) {
  const pathGen = d3.geoPath().projection(projection);
  const countries = topojson.feature(worldTopo, worldTopo.objects.countries);
  const dotR = Math.max(5.5, Math.min(8.5, W / 85));
  const margin = dotR * 2;

  const cells = deltaData.map(d => {
    const lon = d.lon > 180 ? d.lon - 360 : d.lon;
    const proj = projection([lon, d.lat]);
    if (!proj) return null;
    const [px, py] = proj;
    if (px < -margin || px > W + margin || py < -margin || py > H + margin) return null;
    return { ...d, px, py, basin: getBasin(d.lat), key: `${d.lat},${d.lon}`, normLon: lon };
  }).filter(Boolean);

  const svg = d3.select(selector).append('svg')
    .attr('width', W).attr('height', H)
    .style('display', 'block').style('margin', '0 auto')
    .attr('class', 'viz-svg');

  svg.append('rect').attr('width', W).attr('height', H).attr('fill', '#0a2d4a');

  svg.append('path')
    .datum(d3.geoGraticule().step([10, 5])())
    .attr('d', pathGen)
    .attr('fill', 'none')
    .attr('stroke', '#0a2540')
    .attr('stroke-width', 0.5)
    .attr('opacity', 0.5);

  const dots = svg.append('g').selectAll('.delta-dot')
    .data(cells).enter().append('circle')
    .attr('class', 'delta-dot')
    .attr('cx', d => d.px).attr('cy', d => d.py)
    .attr('r', dotR)
    .attr('fill', '#e2f0f7')
    .attr('stroke', '#020d1a')
    .attr('stroke-width', 1.25)
    .attr('opacity', 0.88);

  svg.append('path')
    .datum(countries).attr('d', pathGen)
    .attr('fill', '#0f1a24').attr('stroke', '#1a3a52')
    .attr('stroke-width', 0.5).attr('opacity', 0.96)
    .style('pointer-events', 'none');

  dots
    .on('mouseover', (event, d) => {
      const year = +document.getElementById('map-year-slider').value;
      const ph1850 = cellYearPH.get(d.key)?.get(1850);
      const phYear = cellYearPH.get(d.key)?.get(year);
      const delta = (ph1850 != null && phYear != null) ? phYear - ph1850 : null;
      showTooltip(event,
        `<strong>${d.basin}</strong><br>${d.lat}°, ${d.normLon.toFixed(0)}°<br>` +
        `${year} pH: ${phYear?.toFixed(4) ?? '—'}<br>` +
        `<span style="color:#ff4d6d">Δ from 1850: ${delta?.toFixed(4) ?? '—'}</span>`);
    })
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip);

  return { dots, dotR };
}

function renderMapNotes() {
  d3.select('#map-annotation-cards').remove();

  const notes = [
    {
      title: 'Bering Sea: sharp decline',
      text: 'Cold, nutrient-rich water absorbs CO₂ rapidly. By 2014 the Bering Sea has reddened dramatically — among the most acidified ocean regions on Earth.'
    },
    {
      title: 'Philippine Sea: a gentler shift',
      text: 'Warm tropical surface water holds less dissolved CO₂, buffering acidification. The pH drop near the Philippines is real but far smaller than at high latitudes.'
    },
    {
      title: 'Drag the slider to compare',
      text: 'Start at 1850 — all blue. Drag right to 2014 and watch the Bering Sea redden while the Philippine Sea stays relatively stable.'
    }
  ];

  const wrap = d3.select('#section-map')
    .append('div')
    .attr('id', 'map-annotation-cards');

  const cards = wrap.selectAll('.map-note-card')
    .data(notes)
    .enter()
    .append('div')
    .attr('class', 'map-note-card');

  cards.append('h4')
    .text(d => d.title);

  cards.append('p')
    .text(d => d.text);
}

function renderBrushChart(panel, trendData, cellCount, basins) {
  panel.innerHTML = '';

  const W = Math.min(document.getElementById('viz-map').clientWidth || 900, 1180);
  const H = 200;
  const m = { top: 32, right: 28, bottom: 40, left: 60 };
  const iW = W - m.left - m.right;
  const iH = H - m.top - m.bottom;

  const header = document.createElement('div');
  header.className = 'brush-chart-header';
  header.innerHTML =
    `<span class="brush-chart-title">Custom Selection</span>` +
    `<span class="brush-chart-meta">${cellCount} grid cells &nbsp;·&nbsp; ${basins.join(', ')}</span>`;
  panel.appendChild(header);

  const svg = d3.select(panel).append('svg')
    .attr('width', W).attr('height', H).attr('class', 'viz-svg');

  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  const x = d3.scaleLinear().domain([1850, 2014]).range([0, iW]);
  const [yMin, yMax] = d3.extent(trendData, d => d.ph);
  const y = d3.scaleLinear().domain([yMin - 0.003, yMax + 0.006]).range([iH, 0]);

  g.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
    .selectAll('.tick line').attr('stroke', '#0e2a3d').attr('stroke-dasharray', '3,4');
  g.select('.domain').remove();

  g.append('g').attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8))
    .call(gr => { gr.select('.domain').attr('stroke','#0e2a3d'); gr.selectAll('text').attr('fill','#7fb3c8'); });
  g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.3f')))
    .call(gr => { gr.select('.domain').attr('stroke','#0e2a3d'); gr.selectAll('text').attr('fill','#7fb3c8'); });

  g.append('text').attr('transform','rotate(-90)').attr('x',-iH/2).attr('y',-m.left+14)
    .attr('text-anchor','middle').attr('fill','#7fb3c8').style('font-size','11px').text('Mean Sea Surface pH');

  const baseline = trendData[0].ph;

  g.append('line')
    .attr('x1', 0).attr('x2', iW).attr('y1', y(baseline)).attr('y2', y(baseline))
    .attr('stroke', '#f4a261').attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.8);
  g.append('text')
    .attr('x', iW - 4).attr('y', y(baseline) - 7)
    .attr('text-anchor', 'end').attr('fill', '#f4a261').style('font-size', '11px')
    .text(`1850 baseline (${baseline.toFixed(3)})`);

  g.append('path').datum(trendData)
    .attr('fill', '#ff4d6d').attr('opacity', 0.1)
    .attr('d', d3.area().x(d => x(d.year)).y0(y(baseline)).y1(d => y(d.ph)).curve(d3.curveCatmullRom));

  const linePath = g.append('path').datum(trendData)
    .attr('fill', 'none').attr('stroke', '#00b4d8').attr('stroke-width', 2.5)
    .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.ph)).curve(d3.curveCatmullRom));

  const len = linePath.node().getTotalLength();
  linePath.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
    .transition().duration(800).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);

  const last = trendData[trendData.length - 1];
  const delta = last.ph - baseline;
  g.append('circle').attr('cx', x(last.year)).attr('cy', y(last.ph))
    .attr('r', 4.5).attr('fill', '#ff4d6d').attr('stroke', '#020d1a').attr('stroke-width', 2);
  g.append('text')
    .attr('x', x(last.year) - 8).attr('y', y(last.ph) - 9)
    .attr('text-anchor', 'end').attr('fill', '#ff4d6d').style('font-size', '11px').style('font-weight', '700')
    .text(`Δ ${delta.toFixed(3)} by 2014`);
}

function renderMapLegend(lessChange, mostAcidified, colorScale) {
  const lW = 220;
  const lH = 14;

  const svg = d3.select('#legend-svg')
    .attr('width', lW + 8)
    .attr('height', lH + 22);

  svg.selectAll('*').remove();

  const defs = svg.append('defs');

  const grad = defs.append('linearGradient')
    .attr('id', 'delta-grad')
    .attr('x1', '0%')
    .attr('x2', '100%');

  d3.range(0, 1.01, 0.05).forEach(t => {
    const value = lessChange + t * (mostAcidified - lessChange);

    grad.append('stop')
      .attr('offset', `${t * 100}%`)
      .attr('stop-color', colorScale(value));
  });

  svg.append('rect')
    .attr('width', lW)
    .attr('height', lH)
    .attr('rx', 3)
    .attr('fill', 'url(#delta-grad)');

  svg.append('text')
    .attr('x', 0)
    .attr('y', lH + 14)
    .attr('fill', '#7fb3c8')
    .style('font-size', '10px')
    .text(lessChange.toFixed(3));

  svg.append('text')
    .attr('x', lW)
    .attr('y', lH + 14)
    .attr('text-anchor', 'end')
    .attr('fill', '#7fb3c8')
    .style('font-size', '10px')
    .text(mostAcidified.toFixed(3));
}

// ── ACIDITY GUESS WIDGET ──────────────────────────────────────────────────────

function renderAcidificationGuess(allSeries) {
  const beringSeries   = allSeries.find(s => s.basin === 'Bering Sea');
  const tropicalSeries = allSeries.find(s => s.basin === 'Tropical');
  const widget = document.getElementById('acidity-guess-widget');
  if (!beringSeries || !tropicalSeries || !widget) return;

  const beringFirst = beringSeries.values[0];
  const beringLast  = beringSeries.values[beringSeries.values.length - 1];
  const beringDrop  = beringFirst.ph - beringLast.ph;

  const tropFirst = tropicalSeries.values[0];
  const tropLast  = tropicalSeries.values[tropicalSeries.values.length - 1];
  const tropDrop  = tropFirst.ph - tropLast.ph;

  const beringAcidPct = (Math.pow(10, beringDrop) - 1) * 100;
  const tropAcidPct   = (Math.pow(10, tropDrop)   - 1) * 100;

  widget.innerHTML = `
    <p class="guess-question">Since 1850, how much more acidic has each region become?</p>
    <p class="guess-hint">Bering Sea dropped <strong class="guess-hl">${beringDrop.toFixed(2)} pH units</strong> · Tropics dropped <strong class="guess-hl">${tropDrop.toFixed(2)} pH units</strong>. Enter your best guess for each.</p>
    <div class="guess-two-inputs">
      <div class="guess-field">
        <label class="guess-field-label" style="color:#ff6b00">Bering Sea</label>
        <div class="guess-field-input-row">
          <input type="number" id="guess-bering" min="0" max="999" step="1" placeholder="?">
          <span class="guess-pct-label">% more acidic</span>
        </div>
      </div>
      <div class="guess-field">
        <label class="guess-field-label" style="color:var(--teal)">Tropics</label>
        <div class="guess-field-input-row">
          <input type="number" id="guess-trop" min="0" max="999" step="1" placeholder="?">
          <span class="guess-pct-label">% more acidic</span>
        </div>
      </div>
    </div>
    <button id="guess-reveal-btn" class="guess-btn">Reveal the answer</button>
    <div id="guess-result" class="guess-result"></div>
  `;

  const inputBering = widget.querySelector('#guess-bering');
  const inputTrop   = widget.querySelector('#guess-trop');
  const btn         = widget.querySelector('#guess-reveal-btn');
  const result      = widget.querySelector('#guess-result');

  btn.addEventListener('click', () => {
    const guessBering = parseFloat(inputBering.value);
    const guessTrop   = parseFloat(inputTrop.value);
    let invalid = false;
    if (isNaN(guessBering) || guessBering < 0) { inputBering.classList.add('guess-input-error'); invalid = true; } else inputBering.classList.remove('guess-input-error');
    if (isNaN(guessTrop)   || guessTrop   < 0) { inputTrop.classList.add('guess-input-error');   invalid = true; } else inputTrop.classList.remove('guess-input-error');
    if (invalid) return;

    btn.disabled = true;
    inputBering.disabled = true;
    inputTrop.disabled = true;
    btn.textContent = 'Answer revealed';

    const maxPct     = Math.max(beringAcidPct, tropAcidPct);
    const beringBarW = Math.round((beringAcidPct / maxPct) * 100);
    const tropBarW   = Math.round((tropAcidPct   / maxPct) * 100);

    result.innerHTML = `
      <div class="guess-bars">
        <div class="guess-bar-row">
          <span class="guess-bar-label" style="color:#ff6b00">Bering Sea</span>
          <div class="guess-bar-track">
            <div class="guess-bar" style="width:${beringBarW}%; background:#ff6b00"></div>
          </div>
          <span class="guess-bar-val"><span class="guess-hl-red">${beringAcidPct.toFixed(0)}%</span> <span class="guess-your-val">(you: ${guessBering.toFixed(0)}%)</span></span>
        </div>
        <div class="guess-bar-row">
          <span class="guess-bar-label" style="color:var(--teal)">Tropics</span>
          <div class="guess-bar-track">
            <div class="guess-bar" style="width:${tropBarW}%; background:var(--teal)"></div>
          </div>
          <span class="guess-bar-val"><span class="guess-hl">${tropAcidPct.toFixed(0)}%</span> <span class="guess-your-val">(you: ${guessTrop.toFixed(0)}%)</span></span>
        </div>
      </div>
      <p class="guess-explain">A pH drop of ${beringDrop.toFixed(2)} means H⁺ concentration multiplied by 10<sup>${beringDrop.toFixed(2)}</sup> = ${Math.pow(10, beringDrop).toFixed(2)}×, a ${beringAcidPct.toFixed(0)}% increase. The tropical ${tropDrop.toFixed(2)} drop gives 10<sup>${tropDrop.toFixed(2)}</sup> = ${Math.pow(10, tropDrop).toFixed(2)}×, or ${tropAcidPct.toFixed(0)}%. Because pH is a base-10 log scale, the actual acidity jump is always much larger than the pH number suggests.</p>
    `;
    result.classList.add('guess-result-visible');
  });
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
      if (el.id === 'section-human' && !el._done) {
        el._done = true;
        setTimeout(() => el._animate?.(), 300);
      }

      observer.unobserve(el);
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
}

// ── VIZ 4: CLEAN STRIC-INTERACTION ECOLOGICAL DOMINO (SECTION 4) ─────────────

function renderEcologicalDomino() {
  const container = document.getElementById('viz-domino');
  if (!container) return;

  const W = container.clientWidth || 800;
  const H = 460;

  d3.select('#viz-domino').selectAll('*').remove();

  const svg = d3.select('#viz-domino').append('svg')
    .attr('width', W)
    .attr('height', H)
    .attr('class', 'viz-svg');

  // Grounded Diamond Pyramid Layout
  const data = {
    nodes: [
      { id: 'ph',        label: '📉 Drop in Ocean pH',       x: W * 0.10, y: H * 0.50 },
      
      { id: 'shellfish', label: '🦪 Bivalves & Clams',       x: W * 0.36, y: H * 0.25 },
      { id: 'walrus',    label: '🦭 Walrus Stocks',          x: W * 0.62, y: H * 0.25 },
      
      { id: 'pteropod',  label: '🐚 Pteropods',              x: W * 0.36, y: H * 0.75 },
      { id: 'salmon',    label: '🐟 Salmon & Cod',           x: W * 0.62, y: H * 0.75 },
      { id: 'polarbear', label: '🐻❄️ Polar Bears',          x: W * 0.84, y: H * 0.75 },
      
      { id: 'inuit',     label: '👥 Inuit Communities',      x: W * 0.88, y: H * 0.40 }
    ],
    links: [
      { source: 'ph',        target: 'shellfish', stage: 1, type: 'curved' },
      { source: 'ph',        target: 'pteropod',  stage: 1, type: 'curved' },
      
      { source: 'shellfish', target: 'walrus',    stage: 2, type: 'straight' },
      { source: 'pteropod',  target: 'salmon',    stage: 2, type: 'straight' },
      
      { source: 'salmon',    target: 'polarbear', stage: 3, type: 'straight' },
      
      { source: 'walrus',    target: 'inuit',     stage: 4, type: 'straight' },
      { source: 'salmon',    target: 'inuit',     stage: 4, type: 'straight' },
      { source: 'polarbear', target: 'inuit',     stage: 4, type: 'straight' }
    ]
  };

  const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
  data.links.forEach(l => {
    l.sourceNode = nodeMap.get(l.source);
    l.targetNode = nodeMap.get(l.target);
  });

  // Dynamic Multipoint Routing Path Generator (Cleaned up Polar Bear source)
  const pathGenerator = (d) => {
    const sX = d.sourceNode.x + 75; // Right edge of source card
    const sY = d.sourceNode.y;
    
    let tX = d.targetNode.x - 75; // Left edge of target card
    let tY = d.targetNode.y;

    if (d.target === 'inuit') {
      if (d.source === 'walrus') {
        // Route from right side of walrus into the TOP of the Inuit card
        const targetTopX = d.targetNode.x;
        const targetTopY = d.targetNode.y - 18;
        return `M ${sX} ${sY} C ${(sX + targetTopX)/2} ${sY}, ${targetTopX} ${(sY + targetTopY)/2}, ${targetTopX} ${targetTopY}`;
      }
      
      if (d.source === 'polarbear') {
        // START FROM TOP-CENTER OF BEAR CARD, shoot up-right into BOTTOM of Inuit card
        const sourceTopCenterX = d.sourceNode.x;
        const sourceTopCenterY = d.sourceNode.y - 18;
        const targetBotX = d.targetNode.x;
        const targetBotY = d.targetNode.y + 18;
        
        // Clean straight-ish diagonal line moving forward and up
        return `M ${sourceTopCenterX} ${sourceTopCenterY} L ${targetBotX} ${targetBotY}`;
      }
      
      if (d.source === 'salmon') {
        // Salmon shoots straight and arcs cleanly into the left-center of Inuit
        return `M ${sX} ${sY} C ${(sX + tX)/2} ${sY}, ${(sX + tX)/2} ${tY}, ${tX} ${tY}`;
      }
    }

    // Default smooth curve layout for the initial columns splitting out
    if (d.type === 'curved') {
      return `M ${sX} ${sY} C ${(sX + tX) / 2} ${sY}, ${(sX + tX) / 2} ${tY}, ${tX} ${tY}`;
    } else {
      return `M ${sX} ${sY} L ${tX} ${tY}`;
    }
  };

  // Render Defs
  const defs = svg.append('defs');
  defs.append('marker')
    .attr('id', 'domino-arrow-normal').attr('viewBox', '0 -5 10 10').attr('refX', 6).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L10,0L0,4').attr('fill', '#0e2a3d');

  defs.append('marker')
    .attr('id', 'domino-arrow-active').attr('viewBox', '0 -5 10 10').attr('refX', 6).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L10,0L0,4').attr('fill', '#ff4d6d');

  // Render Connector paths using hybrid generator
  const links = svg.append('g').selectAll('.domino-link')
    .data(data.links).enter().append('path')
    .attr('class', 'domino-link')
    .attr('d', pathGenerator)
    .attr('fill', 'none')
    .attr('stroke', '#0e2a3d')
    .attr('stroke-width', 2)
    .attr('marker-end', 'url(#domino-arrow-normal)');

  // Draw Container Badges
  const nodes = svg.append('g').selectAll('.domino-node')
    .data(data.nodes).enter().append('g')
    .attr('class', 'domino-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  nodes.append('rect')
    .attr('x', -75)
    .attr('y', -18)
    .attr('width', 150)
    .attr('height', 36)
    .attr('rx', 6)
    .attr('fill', '#0a2540')
    .attr('stroke', '#1a3a52')
    .attr('stroke-width', 1.5);

  nodes.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', 5)
    .attr('fill', '#7fb3c8')
    .style('font-size', '11px')
    .style('font-weight', '500')
    .style('pointer-events', 'none')
    .text(d => d.label);

  function runStrictStage(stageNum) {
    d3.selectAll('.console-btn').classed('active', false);
    d3.select(`#btn-stage-${stageNum}`).classed('active', true);

    // Filter Visibility based on strict stage logic
    links.transition().duration(400)
      .style('opacity', d => d.stage <= stageNum ? 1 : 0)
      .attr('stroke', d => d.stage <= stageNum ? '#ff4d6d' : '#0e2a3d')
      .attr('stroke-width', d => d.stage === stageNum ? 3 : 2)
      .attr('marker-end', d => d.stage <= stageNum ? 'url(#domino-arrow-active)' : 'url(#domino-arrow-normal)');

    nodes.select('rect').transition().duration(400)
      .attr('fill', d => {
        if (d.id === 'ph') return '#01162b';
        if (stageNum >= 1 && (d.id === 'shellfish' || d.id === 'pteropod')) return '#1c0f1a';
        if (stageNum >= 2 && (d.id === 'walrus' || d.id === 'salmon')) return '#1c0f1a';
        if (stageNum >= 3 && d.id === 'polarbear') return '#1c0f1a';
        if (stageNum >= 4 && d.id === 'inuit') return '#2b0c10';
        return '#0a2540';
      })
      .attr('stroke', d => {
        if (d.id === 'ph') return '#00b4d8';
        if (stageNum >= 1 && (d.id === 'shellfish' || d.id === 'pteropod')) return '#ff4d6d';
        if (stageNum >= 2 && (d.id === 'walrus' || d.id === 'salmon')) return '#ff4d6d';
        if (stageNum >= 3 && d.id === 'polarbear') return '#ff4d6d';
        if (stageNum >= 4 && d.id === 'inuit') return '#e63946';
        return '#1a3a52';
      })
      .attr('stroke-width', d => {
        if (d.id === 'ph') return 2;
        if (stageNum === 1 && (d.id === 'shellfish' || d.id === 'pteropod')) return 2.5;
        if (stageNum === 2 && (d.id === 'walrus' || d.id === 'salmon')) return 2.5;
        if (stageNum === 3 && d.id === 'polarbear') return 2.5;
        if (stageNum === 4 && d.id === 'inuit') return 3;
        return 1.5;
      });

    nodes.select('text').transition().duration(400)
      .attr('fill', d => {
        if (d.id === 'ph') return '#00b4d8';
        if (stageNum >= 1 && (d.id === 'shellfish' || d.id === 'pteropod')) return '#ff4d6d';
        if (stageNum >= 2 && (d.id === 'walrus' || d.id === 'salmon')) return '#ff4d6d';
        if (stageNum >= 3 && d.id === 'polarbear') return '#ff4d6d';
        if (stageNum >= 4 && d.id === 'inuit') return '#e63946';
        return '#7fb3c8';
      })
      .style('font-weight', d => {
        if (d.id === 'ph') return '700';
        if (stageNum === 1 && (d.id === 'shellfish' || d.id === 'pteropod')) return '700';
        if (stageNum === 2 && (d.id === 'walrus' || d.id === 'salmon')) return '700';
        if (stageNum === 3 && d.id === 'polarbear') return '700';
        if (stageNum === 4 && d.id === 'inuit') return '700';
        return '500';
      });

    const textTarget = document.getElementById('domino-stage-desc');
    const descriptions = {
      0: `Select a structural stage above to carefully track how ocean acidification systematically dismantles apex biological life for Inuit communities.`,
      1: `<strong>Corrosive Thresholds Breached:</strong> High latitude cold waters absorb carbon at accelerated rates. As pH levels drop, structural calcifiers see shell composition dissolve, which instantly crushes the foundation of the food chain.`,
      2: `<strong>Starvation Cascades Upward:</strong> Without bivalves, bottom-feeding walruses run out of food sources. Additionally, missing pteropod can instantly erase up to 60% of primary food resources for migrating salmon and Pacific cod.`,
      3: `<strong>Apex Disruption:</strong> Without stable salmon and marine consumer patterns, apex predators like the Polar Bear lose reliable fat reserves, causing severe structural shifts in geographic migration patterns.`,
      4: `<strong>The Human Threat:</strong> The domino model breaks landward. Inuit hunters lose reliable navigation safety and traditional targets. Marine food security drops sharply, creating immediate threats for modern cultural preservation.`
    };
    if (textTarget) textTarget.innerHTML = descriptions[stageNum];
  }

  for(let i=0; i<=4; i++) {
    const btn = document.getElementById(`btn-stage-${i}`);
    if(btn) {
      btn.addEventListener('click', () => runStrictStage(i));
    }
  }

  runStrictStage(0);
}