import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

// D3 variables
let svg;
let linkElements;
let nodeElements;
let simulation;
const width = 800;
const height = 500;
const centerX = width / 2;
const centerY = height / 2;

// Function to calculate node radius based on text length
function calculateNodeRadius(d) {
     // Use the same logic as the circle radius, adding a small buffer for collision
     return Math.max(25, 15 + (d.text ? d.text.length : 0) * 3) + 5; // Added 5px buffer
}

// Function to generate related concepts using the AI model
async function generateRelatedConcepts(word) {
    const lowerWord = word.toLowerCase().trim();

    if (!lowerWord) {
        return []; // Return empty if word is empty
    }

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a knowledge graph generator. Given a single word, provide a list of 5-7 concepts closely related to it.
Respond directly with JSON, following this JSON schema, and no other text.
{
  "related_concepts": string[];
}`,
                },
                {
                    role: "user",
                    content: lowerWord,
                },
            ],
            json: true, // Request JSON output
        });

        const result = JSON.parse(completion.content);

        if (result && Array.isArray(result.related_concepts)) {
            // Filter out potential duplicates and the original word itself, and clean strings
            const uniqueConcepts = [...new Set(result.related_concepts)]
                .map(concept => concept.trim().replace(/^['"]|['"]$/g, '')) // Clean potential quotes/spaces
                .filter(concept => concept !== "" && concept.toLowerCase() !== lowerWord) // Filter empty strings and the original word
                .slice(0, 7); // Limit to 7 concepts

            return uniqueConcepts;
        } else {
            console.warn("AI did not return expected JSON format.", completion.content);
            return []; // Return empty array if format is unexpected
        }

    } catch (error) {
        console.error("Error calling AI model:", error);
        // Fallback or error handling - can return empty or a generic message
        // Returning empty means no new nodes are added on error
        return [];
    }
}

// Function to initialize the D3 simulation and SVG
function initializeGraph(container) {
     // Clear previous content (SVG and loading overlay)
    container.innerHTML = '';

    // Create SVG element only once
    svg = d3.select(container)
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`);

    // Initialize force simulation
    simulation = d3.forceSimulation(graphData.nodes)
        // Increase distance for more spacing between linked nodes
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150)) // Increased distance from 100 to 150
        .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion
        .force("center", d3.forceCenter(centerX, centerY)); // Center force
    // Add collision force to prevent node overlap
    .force("collide", d3.forceCollide().radius(calculateNodeRadius).iterations(2)); // Use dynamic radius function

    // Create link and node elements
    linkElements = svg.append("g").selectAll(".relation-line");
    nodeElements = svg.append("g").selectAll(".node"); // Group for nodes (circle + text)

    // Define the tick function to update positions
    simulation.on("tick", () => {
        linkElements
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        // Update node group position (translate)
        nodeElements
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Define drag behavior
    const drag = d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);

    // Apply drag behavior later to entering nodes
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      // Optional: Uncomment these lines if you want nodes to snap back
      // d.fx = null;
      // d.fy = null;
    }

    // Store drag function to apply to new nodes
    svg._dragBehavior = drag; // Attach to SVG for easy access
}

// Function to update D3 elements based on graphData changes
function updateGraph() {
    if (!svg) {
        console.error("SVG not initialized before updating graph.");
        return;
    }

    // Update links
    linkElements = linkElements
        .data(graphData.links, d => d.source.id + "-" + d.target.id) // Data join with key
        .join(
            enter => enter.append("line")
                .attr("class", "relation-line")
                .attr("stroke-opacity", 0) // Start transparent for fade-in
                .transition().duration(500)
                .attr("stroke-opacity", 1), // Fade in
            update => update, // No update needed for static lines
            exit => exit.transition().duration(500).attr("stroke-opacity", 0).remove() // Fade out and remove
        );


    // Update nodes (circle + text group)
    nodeElements = nodeElements
        .data(graphData.nodes, d => d.id) // Data join with key
        .join(
            enter => {
                 const group = enter.append("g")
                     .attr("class", d => d.isCenter ? "center-node node" : "concept-node node")
                     // Initial position for animation (optional: could be parent position)
                     // Force layout will position them afterwards
                     .attr("transform", d => `translate(${d.x || centerX},${d.y || centerY})`)
                     .style("opacity", 0); // Start transparent for fade-in

                 // Add circle
                 group.append("circle")
                     .attr("r", calculateNodeRadius); // Use the radius calculation function

                 // Add text
                 group.append("text")
                     .text(d => d.text)
                     .attr("x", 0)
                     .attr("y", 0)
                     .attr("dy", "0.35em")
                     .attr("text-anchor", "middle")
                     .style("pointer-events", "none")
                     .style("user-select", "none");

                 // Apply drag behavior
                 group.call(svg._dragBehavior);

                 // Add click listener using D3 events
                 group.on('click', (event, d) => {
                     // Stop simulation briefly when clicking
                     simulation.alphaTarget(0).stop();
                     handleExplore(d.id, d3.select("#visualizationArea").node(), d.id); // Explore the clicked word
                     // Prevent event from bubbling up, potentially interfering with drag end
                     event.stopPropagation();
                 });


                 // Animate fade-in
                 group.transition().duration(500).style("opacity", 1);

                 return group;
             },
            update => {
                // Update existing node groups
                 update.select("circle")
                     .attr("r", calculateNodeRadius); // Re-calculate radius in case text changed (unlikely here)
                 update.select("text").text(d => d.text); // Update text (unlikely here)
                 return update;
             },
            exit => exit.transition().duration(500).style("opacity", 0).remove() // Fade out and remove
        );


    // Update simulation nodes and links
    simulation.nodes(graphData.nodes);
    simulation.force("link").links(graphData.links);
    // Update collision force with potentially new nodes/radii
    simulation.force("collide").radius(calculateNodeRadius);

    // Restart simulation
    simulation.alpha(1).restart(); // Set alpha to 1 to restart simulation with full energy
}

// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    if (!word || word.trim() === "") {
        if (!clickedNodeId) { // Only clear and show placeholder if not clicking on a node
             graphData.nodes = [];
             graphData.links = [];
             if (svg) svg.remove(); // Remove SVG if exists
             svg = null; // Reset svg variable
             container.innerHTML = '<p class="placeholder">Please enter a word.</p>';
        }
        return;
    }

    // Add loading indicator
    // Remove any existing loading indicator first
    const existingLoading = container.querySelector('.loading-overlay');
    if(existingLoading) existingLoading.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${word}"...`;
    container.appendChild(loadingOverlay);


    // If it's a new initial exploration from the input box
    if (!clickedNodeId) {
        graphData.nodes = [];
        graphData.links = [];
        // Add the initial node. D3 simulation will position it.
        // Fix center node position
        graphData.nodes.push({ id: word, text: word, isCenter: true, fx: centerX, fy: centerY });
         // Initialize SVG and simulation on the first explore
        initializeGraph(container);
    }
    // Note: If clickedNodeId IS provided, we do NOT clear graphData. We add to it.

    // Find the node for the word being explored to set its fixed position temporarily
    // This helps new nodes spawn relative to it initially
    const exploringNode = graphData.nodes.find(n => n.id === word);
     if (exploringNode) {
         // Temporarily fix the position of the node being explored
         // Use current position if available, otherwise center
        exploringNode.fx = exploringNode.x || centerX;
        exploringNode.fy = exploringNode.y || centerY;
     }


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(word);

    // Remove loading indicator after AI call
    loadingOverlay.remove();

     // Unfix the exploring node after getting results
    if (exploringNode && !exploringNode.isCenter) { // Don't unfix the *initial* center node permanently
        exploringNode.fx = null;
        exploringNode.fy = null;
    }


    // Add new nodes and links to graphData
    const newNodes = [];
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim(); // Use trimmed concept for ID and text

        if (!cleanConcept) return; // Skip empty concepts

        // Add node if it doesn't exist
        const existingNode = graphData.nodes.find(n => n.id === cleanConcept);
        if (!existingNode) {
            // Add new node.
             const newNode = { id: cleanConcept, text: cleanConcept, parentId: word }; // Keep parentId for potential future use (e.g., styling)
             graphData.nodes.push(newNode);
             newNodes.push(newNode); // Keep track of newly added nodes
        }

        // Add link if it doesn't exist (check both directions)
        const linkExists = graphData.links.some(link =>
            (link.source.id === word && link.target.id === cleanConcept) ||
            (link.source.id === cleanConcept && link.target.id === word)
        );

        if (!linkExists) {
            graphData.links.push({ source: word, target: cleanConcept });
        }
    });

     // Set initial position for new nodes near their parent for smoother animation
     const parentNode = graphData.nodes.find(n => n.id === word);
     if (parentNode) {
         newNodes.forEach(newNode => {
             // If the node has no initial position set by the simulation yet,
             // position it near the parent for the start of the transition.
             // This helps nodes animate from near their parent.
             if (newNode.x === undefined) {
                 newNode.x = parentNode.x;
                 newNode.y = parentNode.y;
             }
         });
     }

    // Update the D3 graph representation
    updateGraph();

    // If no new concepts were added and it was an exploration click, provide feedback?
    // This is still tricky with incremental updates. For now, rely on the graph not changing.
}

// Setup function called from script.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        // If graph is empty, initialize it. Otherwise, handleExplore will update.
        if (graphData.nodes.length === 0 && word.trim() !== "") {
             initializeGraph(visualizationArea);
        }
        handleExplore(word, visualizationArea); // Initial explore, no clickedNodeId
    });

    // Optional: Allow pressing Enter in the input field
    wordInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission
            exploreButton.click();
        }
    });

    // Initial state: display placeholder
    visualizationArea.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
}