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

  renderGlobalTrend(globalByYear);
  renderRegionalChart(regionalSeries);
  renderAcidificationGuess(regionalSeries);
  renderDeltaMap(deltaData, worldTopo, regionalMap, data);
  renderBeringChart(data, globalByYear);
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
    .attr('x', 6).attr('y', y(globalByYear[0].ph) - 7)
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
      .attr('x', cx).attr('y', y(ph) - 8)
      .attr('text-anchor', 'middle').attr('fill', '#ff4d6d').style('font-size', '9px')
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
      .attr('opacity', d => !basin || d.basin === basin ? 1 : 0.16)
      .attr('stroke-width', d => basin && d.basin === basin ? 3.3 : 2.2);

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
      .attr('stroke-width', 2.2)
      .attr('opacity', 0.9)
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
  const container = document.getElementById('viz-map');
  const W = Math.min(container.parentElement.clientWidth || window.innerWidth * 0.9, 1180);
  const H = Math.round(W * 0.90);

  const projection = d3.geoAzimuthalEqualArea()
    .rotate([180, -57])
    .clipAngle(33)
    .scale(W * 0.75)
    .translate([W / 2, H / 2]);

  const path = d3.geoPath().projection(projection);
  const countries = topojson.feature(worldTopo, worldTopo.objects.countries);

  const svg = d3.select('#viz-map').append('svg')
    .attr('width', W)
    .attr('height', H)
    .style('display', 'block')
    .style('margin', '0 auto')
    .attr('class', 'viz-svg');

  svg.append('rect')
    .attr('width', W)
    .attr('height', H)
    .attr('fill', '#010a14');

  svg.append('path')
    .datum(d3.geoGraticule().step([30, 10])())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', '#0a2540')
    .attr('stroke-width', 0.45)
    .attr('opacity', 0.4);

  const sortedDeltas = deltaData.map(d => d.delta).sort((a, b) => a - b);
  const stretchedMin = d3.quantile(sortedDeltas, 0.03);
  const bandColorScale = d3.scaleSequential()
    .domain([0, stretchedMin])
    .interpolator(t => d3.interpolateRdYlBu(1 - t))
    .clamp(true);

  const sliderEl = document.getElementById('map-year-slider');
  const yearReadout = d3.select('#map-year-readout');

  // Per-cell per-year pH lookup
  const cellYearPH = new Map();
  rawData.forEach(d => {
    const key = `${d.lat},${d.lon}`;
    if (!cellYearPH.has(key)) cellYearPH.set(key, new Map());
    cellYearPH.get(key).set(d.year, d.ph);
  });

  // Project all ocean cells — projection clipAngle handles visible extent
  const dotR = Math.max(4.5, Math.min(7.5, W / 145));
  const cells = deltaData.map(d => {
    const lon = d.lon > 180 ? d.lon - 360 : d.lon;
    const proj = projection([lon, d.lat]);
    return { ...d, px: proj?.[0], py: proj?.[1], basin: getBasin(d.lat), key: `${d.lat},${d.lon}` };
  }).filter(d => d.px != null && !isNaN(d.px));

  // Draw one dot per grid cell
  const dots = svg.append('g')
    .selectAll('.delta-dot')
    .data(cells)
    .enter().append('circle')
    .attr('class', 'delta-dot')
    .attr('cx', d => d.px)
    .attr('cy', d => d.py)
    .attr('r', dotR)
    .attr('fill', '#e2f0f7')
    .attr('opacity', 0.82);

  // Land mask on top
  svg.append('path')
    .datum(countries)
    .attr('d', path)
    .attr('fill', '#0f1a24')
    .attr('stroke', '#1a3a52')
    .attr('stroke-width', 0.45)
    .attr('opacity', 0.96)
    .style('pointer-events', 'none');

  function updateDots(year) {
    dots.attr('fill', d => {
      const ph1850 = cellYearPH.get(d.key)?.get(1850);
      const phYear = cellYearPH.get(d.key)?.get(year);
      return (ph1850 != null && phYear != null) ? bandColorScale(phYear - ph1850) : '#334';
    });
    yearReadout.text(year);
    const pct = ((year - 1850) / (2014 - 1850)) * 100;
    sliderEl.style.background = `linear-gradient(to right, var(--teal) ${pct}%, #0e2a3d ${pct}%)`;
  }

  // Cross-link with Viz 2 regional chart hover
  updateMapRegionFocus = basin => {
    dots
      .attr('opacity', d => !basin || d.basin === basin ? 0.90 : 0.10)
      .attr('r', d => basin && d.basin === basin ? dotR * 1.2 : dotR * 0.75);
  };

  dots
    .on('mouseover', (event, d) => {
      const year = +sliderEl.value;
      const ph1850 = cellYearPH.get(d.key)?.get(1850);
      const phYear = cellYearPH.get(d.key)?.get(year);
      const delta = (ph1850 != null && phYear != null) ? phYear - ph1850 : null;
      const dispLon = d.lon > 180 ? d.lon - 360 : d.lon;
      showTooltip(event,
        `<strong>${d.basin}</strong><br>` +
        `${d.lat}°, ${dispLon}°<br>` +
        `${year} pH: ${phYear?.toFixed(4) ?? '—'}<br>` +
        `<span style="color:#ff4d6d">Δ from 1850: ${delta?.toFixed(4) ?? '—'}</span>`);
    })
    .on('mousemove', moveTooltip)
    .on('mouseout', hideTooltip);

  sliderEl.addEventListener('input', () => updateDots(+sliderEl.value));

  updateDots(1850);

  // ── Brush for custom region selection ──────────────────────────────────────
  const brushPanel = document.createElement('div');
  brushPanel.id = 'brush-chart-panel';
  brushPanel.innerHTML = '<p class="brush-hint">Drag on the map above to plot a custom region\'s pH trend</p>';

  let currentSelection = null;

  const mapBrush = d3.brush()
    .extent([[0, 0], [W, H]])
    .on('brush', ({ selection }) => {
      if (!selection) return;
      currentSelection = selection;
      const [[x0, y0], [x1, y1]] = selection;
      dots
        .attr('opacity', d => (d.px >= x0 && d.px <= x1 && d.py >= y0 && d.py <= y1) ? 1.0 : 0.12)
        .attr('r',       d => (d.px >= x0 && d.px <= x1 && d.py >= y0 && d.py <= y1) ? dotR * 1.2 : dotR * 0.7);
      hideTooltip();
    })
    .on('end', ({ selection }) => {
      currentSelection = selection;
      if (!selection) {
        dots.attr('opacity', 0.82).attr('r', dotR);
        brushPanel.innerHTML = '<p class="brush-hint">Drag on the map above to plot a custom region\'s pH trend</p>';
        return;
      }
      const [[x0, y0], [x1, y1]] = selection;
      const selected = cells.filter(d => d.px >= x0 && d.px <= x1 && d.py >= y0 && d.py <= y1);
      if (!selected.length) return;

      const years = d3.range(1850, 2015);
      const trendData = years.map(year => {
        const phs = selected.map(d => cellYearPH.get(d.key)?.get(year)).filter(v => v != null);
        return phs.length ? { year, ph: d3.mean(phs) } : null;
      }).filter(Boolean);

      const basins = [...new Set(selected.map(d => d.basin))];
      renderBrushChart(brushPanel, trendData, selected.length, basins);
    });

  const brushG = svg.append('g').attr('class', 'map-brush').call(mapBrush);

  // Tooltip passthrough when no brush selection is active
  brushG.select('.overlay')
    .on('mousemove.tooltip', (event) => {
      if (currentSelection) return;
      const [mx, my] = d3.pointer(event);
      const threshold = (dotR * 2.5) ** 2;
      const nearest = cells.reduce((best, d) => {
        const dist2 = (d.px - mx) ** 2 + (d.py - my) ** 2;
        return dist2 < best.dist2 ? { d, dist2 } : best;
      }, { d: null, dist2: Infinity });
      if (nearest.d && nearest.dist2 < threshold) {
        const year = +sliderEl.value;
        const ph1850 = cellYearPH.get(nearest.d.key)?.get(1850);
        const phYear = cellYearPH.get(nearest.d.key)?.get(year);
        const delta = (ph1850 != null && phYear != null) ? phYear - ph1850 : null;
        const dispLon = nearest.d.lon > 180 ? nearest.d.lon - 360 : nearest.d.lon;
        showTooltip(event,
          `<strong>${nearest.d.basin}</strong><br>` +
          `${nearest.d.lat}°, ${dispLon}°<br>` +
          `${year} pH: ${phYear?.toFixed(4) ?? '—'}<br>` +
          `<span style="color:#ff4d6d">Δ from 1850: ${delta?.toFixed(4) ?? '—'}</span>`
        );
      } else {
        hideTooltip();
      }
    })
    .on('mouseleave.tooltip', hideTooltip);

  document.getElementById('section-map')._animate = () => {
    dots.attr('opacity', 0)
      .transition().duration(900)
      .delay((d, i) => i * 2)
      .attr('opacity', 0.82);
  };

  d3.select('#viz-map')
    .style('position', 'relative')
    .style('height', H + 'px')
    .style('max-width', W + 'px')
    .style('margin', '0 auto');

  renderMapLegend(0, stretchedMin, bandColorScale);
  renderMapNotes();
  document.getElementById('section-map').appendChild(brushPanel);
}

function renderMapNotes() {
  d3.select('#map-annotation-cards').remove();

  const notes = [
    {
      title: 'The Bering Sea stands out',
      text: 'With the Bering Sea centered, the contrast is clear: the blue tropics in the lower half of the map have barely moved, while the reds cluster in the upper latitudes — the Bering Sea among the deepest.'
    },
    {
      title: 'Cold water, faster change',
      text: 'The same physics that make the Bering Sea a world-class fishery — cold, nutrient-rich water — also make it absorb CO₂ faster, driving steeper acidification than warmer tropical seas.'
    },
    {
      title: 'Drag the slider to compare over time',
      text: 'Start at 1850 — all blue. Drag right to 2014 and watch the Bering Sea and Arctic redden while the tropics remain relatively stable.'
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

function renderAcidificationGuess(regionalSeries) {
  const arcticSeries   = regionalSeries.find(s => s.basin === 'Arctic');
  const tropicalSeries = regionalSeries.find(s => s.basin === 'Tropical');
  const widget = document.getElementById('acidity-guess-widget');
  if (!arcticSeries || !tropicalSeries || !widget) return;

  const arcticFirst = arcticSeries.values[0];
  const arcticLast  = arcticSeries.values[arcticSeries.values.length - 1];
  const arcticDrop  = arcticFirst.ph - arcticLast.ph;

  const tropFirst = tropicalSeries.values[0];
  const tropLast  = tropicalSeries.values[tropicalSeries.values.length - 1];
  const tropDrop  = tropFirst.ph - tropLast.ph;

  const arcticAcidPct = (Math.pow(10, arcticDrop) - 1) * 100;
  const tropAcidPct   = (Math.pow(10, tropDrop)   - 1) * 100;
  const actualRatio   = arcticAcidPct / tropAcidPct;

  widget.innerHTML = `
    <p class="guess-question">How many times more acidic has the Arctic become compared to the Tropics?</p>
    <p class="guess-hint">Arctic dropped <strong class="guess-hl">${arcticDrop.toFixed(2)} pH units</strong> · Tropics dropped <strong class="guess-hl">${tropDrop.toFixed(2)} pH units</strong>. The pH scale is logarithmic — these don't scale the same way.</p>
    <div class="guess-input-row">
      <input type="number" id="guess-input" min="1" max="99" step="0.1" placeholder="e.g. 2.5">
      <span class="guess-times-label">×</span>
      <button id="guess-reveal-btn" class="guess-btn">Reveal the answer</button>
    </div>
    <div id="guess-result" class="guess-result"></div>
  `;

  const input = widget.querySelector('#guess-input');
  const btn   = widget.querySelector('#guess-reveal-btn');
  const result = widget.querySelector('#guess-result');

  btn.addEventListener('click', () => {
    const guess = parseFloat(input.value);
    if (isNaN(guess) || guess <= 0) { input.classList.add('guess-input-error'); return; }
    input.classList.remove('guess-input-error');
    btn.disabled = true;
    input.disabled = true;
    btn.textContent = 'Answer revealed';
    const close = Math.abs(guess - actualRatio) <= 0.5;
    const feedback = close
      ? ''
      : guess < actualRatio
        ? ''
        : '';

    const arcticBarW = 100;
    const tropBarW   = Math.round((tropAcidPct / arcticAcidPct) * 100);

    result.innerHTML = `
      <div class="guess-bars">
        <div class="guess-bar-row">
          <span class="guess-bar-label">Arctic</span>
          <div class="guess-bar" style="width:${arcticBarW}%; background:var(--red)"></div>
          <span class="guess-bar-val">${arcticAcidPct.toFixed(0)}% more acidic</span>
        </div>
        <div class="guess-bar-row">
          <span class="guess-bar-label">Tropics</span>
          <div class="guess-bar" style="width:${tropBarW}%; background:var(--teal)"></div>
          <span class="guess-bar-val">${tropAcidPct.toFixed(0)}% more acidic</span>
        </div>
      </div>
      <p class="guess-answer-line">The Arctic has acidified <strong class="guess-hl-red">${actualRatio.toFixed(1)}×</strong> as much as the Tropics — your guess was <strong>${guess.toFixed(1)}×</strong>. ${feedback}</p>
      <p class="guess-explain">A ${arcticDrop.toFixed(2)} pH drop means H⁺ concentration rose by ${arcticAcidPct.toFixed(0)}%. The tropical ${tropDrop.toFixed(2)} drop means only ${tropAcidPct.toFixed(0)}%. Because pH is a base-10 log scale, that extra ${(arcticDrop - tropDrop).toFixed(2)} pH units compounds into a far bigger jump in actual acidity than it looks on the chart.</p>
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
