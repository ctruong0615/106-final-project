const margin = {top: 40, right: 30, bottom: 40, left: 60},
      width = 800 - margin.left - margin.right,
      height = 400 - margin.top - margin.bottom;

const svg = d3.select("#visualization")
  .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
  .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

const tooltip = d3.select("#tooltip");

// Set the optimal baseline pH for marine life
const optimalPh = 8.10; 

d3.csv("ocean_acidification_data.csv").then(function(data) {

    // Format strings to numbers
    data.forEach(d => {
        d.year = +d.year;
        d.ph = +d.ph;
    });

    // Group by year and calculate the mean pH across the spatial grid
    const avgData = Array.from(d3.rollup(data, 
        v => d3.mean(v, leaf => leaf.ph), 
        d => d.year
    ), ([year, ph]) => ({year, ph}))
    .sort((a, b) => d3.ascending(a.year, b.year));

    // X axis: Years
    const x = d3.scaleLinear()
      .domain(d3.extent(avgData, d => d.year))
      .range([ 0, width ]);
    
    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")));

    // Y axis: pH limits dynamically scaled
    const y = d3.scaleLinear()
      .domain([d3.min(avgData, d => d.ph) - 0.01, Math.max(optimalPh, d3.max(avgData, d => d.ph)) + 0.01])
      .range([ height, 0 ]);
      
    svg.append("g").call(d3.axisLeft(y));

    // Y axis label
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left + 15)
      .attr("x", 0 - (height / 2))
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .text("Sea Surface pH");

    // 1. Draw the Deficit Area (Hidden initially)
    const area = d3.area()
      .x(d => x(d.year))
      .y0(y(optimalPh)) // Top of the shaded area is the baseline
      .y1(d => y(d.ph)); // Bottom is the actual data

    const deficitPath = svg.append("path")
      .datum(avgData.filter(d => d.ph < optimalPh)) // Only shade when below baseline
      .attr("class", "deficit-area")
      .attr("d", area);

    // 2. Draw the Optimal Baseline
    svg.append("line")
      .attr("class", "baseline")
      .attr("x1", 0)
      .attr("x2", width)
      .attr("y1", y(optimalPh))
      .attr("y2", y(optimalPh));

    svg.append("text")
      .attr("class", "baseline-label")
      .attr("x", width - 10)
      .attr("y", y(optimalPh) - 8)
      .attr("text-anchor", "end")
      .text("Optimal Marine Baseline (pH 8.10)");

    // 3. Draw the actual data line
    svg.append("path")
      .datum(avgData)
      .attr("class", "line")
      .attr("d", d3.line()
        .x(d => x(d.year))
        .y(d => y(d.ph))
      );

    // 4. Add interactive dots
    svg.selectAll(".dot")
      .data(avgData)
      .enter()
      .append("circle")
        .attr("class", "dot")
        .attr("cx", d => x(d.year))
        .attr("cy", d => y(d.ph))
        .attr("r", 5)
        .on("mouseover", function(event, d) {
            d3.select(this).attr("r", 8);
            
            // Calculate deficit
            const deficit = optimalPh - d.ph;
            const deficitText = deficit > 0 ? `<br><span style="color:#ffb703">Deficit: -${deficit.toFixed(4)}</span>` : "";

            tooltip.transition().duration(200).style("opacity", 1);
            tooltip.html(`<strong>Year:</strong> ${d.year}<br><strong>Avg pH:</strong> ${d.ph.toFixed(4)}${deficitText}`)
                   .style("left", (event.pageX + 15) + "px")
                   .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function(d) {
            d3.select(this).attr("r", 5);
            tooltip.transition().duration(500).style("opacity", 0);
        });

    // 5. Interaction Logic for the Toggle Button
    let deficitVisible = false;
    d3.select("#toggleBaseline").on("click", function() {
        deficitVisible = !deficitVisible;
        
        deficitPath.transition()
            .duration(800)
            .style("opacity", deficitVisible ? 0.2 : 0);

        d3.select(this)
            .text(deficitVisible ? "Hide Acidification Deficit" : "Show Acidification Deficit")
            .style("background-color", deficitVisible ? "#2b2d42" : "#ef233c");
    });
});