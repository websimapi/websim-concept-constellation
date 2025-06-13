import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

// D3 variables
let svg;
let defs; // Added variable for <defs>
let graphGroup; // Group to hold nodes and links, for zooming and panning
let linkElements;
let nodeElements;
let simulation;
let zoom; // D3 zoom behavior
// Use dynamic width and height based on the container
let width = 0;
let height = 0;
let centerX = 0;
let centerY = 0;

// Function to update dimensions based on container size
function updateDimensions(container) {
    width = container.clientWidth;
    height = container.clientHeight;
    centerX = width / 2;
    centerY = height / 2;

    if (svg) {
        svg.attr("viewBox", `0 0 ${width} ${height}`);
    }
     if (simulation) {
        simulation.force("center", d3.forceCenter(centerX, centerY));
        // Restart simulation with updated center force
        simulation.alpha(0.3).restart();
    }

    // If center node exists, update its fixed position
    const centerNode = graphData.nodes.find(n => n.isCenter);
    if (centerNode) {
        centerNode.fx = centerX;
        centerNode.fy = centerY;
    }
}

// Function to calculate node radius based on text length
function calculateNodeRadius(d) {
     // Use the same logic as the circle radius, adding a small buffer for collision
     // Ensure d.text exists before accessing length
     // Radius should be large enough to contain text and look good with an image
     return Math.max(30, 15 + (d.text ? d.text.length : 0) * 3); // Base radius 30, text influence
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
                .filter(concept => concept !== "" && concept.toLowerCase() !== lowerWord) // Filter empty strings and the original word (case-insensitive)
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

// Function to generate image for a node using AI
async function generateNodeImage(node) {
    if (!node || !node.text) {
        console.warn("Cannot generate image for node:", node);
        return null;
    }

    console.log(`Generating image for "${node.text}"...`);
    try {
        const result = await websim.imageGen({
            prompt: `A stylistic icon or abstract representation of the concept: "${node.text}". Suitable for a small circle background. Avoid text.`,
            aspect_ratio: "1:1", // Square is best for circle
            transparent: false // Background is okay, we'll crop visually with the circle
        });
        console.log(`Image generated for "${node.text}": ${result.url}`);
        return result.url;
    } catch (error) {
        console.error(`Error generating image for "${node.text}":`, error);
        return null; // Indicate failure
    }
}

// Function to initialize the D3 simulation and SVG
function initializeGraph(container) {
     // Clear previous content (SVG and loading overlay)
    container.innerHTML = '';

    // Update dimensions based on container size before creating SVG
    updateDimensions(container);

    // Create SVG element only once
    svg = d3.select(container)
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`); // Use dynamic dimensions

    // Add a <defs> section for patterns
    defs = svg.append("defs"); // Initialize defs variable

    // Create a group for the graph elements (nodes and links) that will be zoomed/panned
    graphGroup = svg.append("g");

    // Initialize force simulation
    simulation = d3.forceSimulation(graphData.nodes)
        // Increase distance for more spacing between linked nodes
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150)) // Increased distance from 100 to 150
        .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion
        .force("center", d3.forceCenter(centerX, centerY)) // Center force (use dynamic center)
        // Add collision force to prevent node overlap
        // Use radius calculated by calculateNodeRadius + buffer
        .force("collide", d3.forceCollide().radius(d => calculateNodeRadius(d) + 5).iterations(2)); // Add a small buffer for collision detection

    // Create group for links (will be appended first to be underneath)
    linkElements = graphGroup.append("g").attr("class", "links").selectAll(".relation-line");

    // Create group for nodes (will be appended second to be on top)
    nodeElements = graphGroup.append("g").attr("class", "nodes").selectAll(".node"); // Group for nodes (circle + text)

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
      // d.fy = null; // Keep y fixed if it's the center node, otherwise null? No, let simulation handle it.
    }

    // Store drag function to apply to new nodes
    svg._dragBehavior = drag; // Attach to SVG for easy access

    // --- Zoom Implementation ---
    zoom = d3.zoom()
        .scaleExtent([0.1, 4]) // Allow zooming from 0.1x to 4x
        .on("zoom", (event) => {
             graphGroup.attr("transform", event.transform); // Apply zoom transform to the graph group
        });

    // Apply the zoom behavior to the SVG
    svg.call(zoom);

     // Add window resize listener to update dimensions and restart simulation
     window.addEventListener('resize', () => {
         updateDimensions(container);
         // Need to call updateGraph() or similar to ensure nodes and links are re-bound
         // Or simply restart simulation, forces should handle re-centering
          simulation.alpha(1).restart();
     });
}

// Function to update D3 elements based on graphData changes
function updateGraph() {
    const container = d3.select("#visualizationArea").node(); // Get container reference
    if (!svg || !graphGroup || !defs || !container) { // Check for defs existence
        console.error("SVG, graphGroup, defs, or container not initialized before updating graph.");
        return;
    }

    // Ensure dimensions are up-to-date before updating graph elements
    updateDimensions(container);

    // --- Update Patterns for Images ---
    // Filter nodes to only include those that have an image URL to create patterns for
    const nodesWithImages = graphData.nodes.filter(d => d.imageUrl);

    const patterns = defs.selectAll("pattern")
        .data(nodesWithImages, d => `pattern-${d.id}`); // Join on node id with "pattern-" prefix

    // Enter new patterns
    const enterPatterns = patterns.enter().append("pattern")
        .attr("id", d => `pattern-${d.id}`) // Unique ID
        .attr("patternUnits", "objectBoundingBox") // Coordinates are relative to the object (the circle)
        .attr("width", 1) // Full width of object bounding box
        .attr("height", 1); // Full height of object bounding box

    // Add image to new patterns
    enterPatterns.append("image")
        .attr("xlink:href", d => d.imageUrl) // Image URL
        .attr("x", 0) // Position at top-left of the pattern area
        .attr("y", 0)
        .attr("width", 1) // Full width of pattern area
        .attr("height", 1) // Full height of pattern area
        .attr("preserveAspectRatio", "xMidYMid slice"); // Scale and crop to cover the area

    // Update existing patterns (only need to update image href if it could change, unlikely here)
    patterns.select("image")
        .attr("xlink:href", d => d.imageUrl);

    // Exit old patterns (for nodes whose images are removed or data changes)
    patterns.exit().remove();

    // --- Update Links ---
    // Select links within the graphGroup (within the 'links' group if it exists)
    linkElements = graphGroup.select(".links").selectAll(".relation-line")
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

    // --- Update Nodes ---
    // Select nodes within the graphGroup (within the 'nodes' group if it exists)
    nodeElements = graphGroup.select(".nodes").selectAll(".node")
        .data(graphData.nodes, d => d.id) // Data join with key (using lowercase ID)
        .join(
            enter => {
                 const group = enter.append("g")
                     .attr("class", d => d.isCenter ? "center-node node" : "concept-node node")
                     // Initial position for animation
                     .attr("transform", d => `translate(${d.x || centerX},${d.y || centerY})`)
                     .style("opacity", 0); // Start transparent for fade-in

                 // Add circle
                 group.append("circle")
                     .attr("r", calculateNodeRadius) // Use the radius calculation function
                     // Set initial fill (default color or loading gray)
                     .attr("fill", d => d.imageLoading ? '#ddd' : (d.isCenter ? '#28a745' : '#007bff'));

                 // Add text (append after circle so it's on top)
                 group.append("text")
                     .text(d => d.text) // Use node's text property (lowercase)
                     .attr("x", 0)
                     .attr("y", 0)
                     .attr("dy", "0.35em")
                     .attr("text-anchor", "middle")
                     .style("pointer-events", "none")
                     .style("user-select", "none");

                 // Apply drag behavior
                 if (svg && svg._dragBehavior) { // Check if drag behavior is defined on the svg
                     group.call(svg._dragBehavior);
                 }

                 // Add click listener using D3 events
                 group.on('click', (event, d) => {
                     // Stop simulation briefly when clicking
                     simulation.alphaTarget(0).stop();
                     // Pass the clicked node's lowercase ID for exploration
                     handleExplore(d.id, d3.select("#visualizationArea").node(), d.id);
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
                     .attr("r", calculateNodeRadius) // Re-calculate radius
                     // Update fill based on imageUrl or loading state
                     .attr("fill", d => d.imageUrl ? `url(#pattern-${d.id})` : (d.imageLoading ? '#ddd' : (d.isCenter ? '#28a745' : '#007bff'))); // Use pattern or color fill

                 update.select("text").text(d => d.text); // Update text

                 // Animate position updates? Force simulation handles it.
                 // Animate fade-in/out handled by enter/exit.
                 // No need to re-apply drag or click listeners, they are attached to the group on enter
                 return update;
             },
            exit => exit.transition().duration(500).style("opacity", 0).remove() // Fade out and remove
        );

    // Update simulation nodes and links
    simulation.nodes(graphData.nodes);
    simulation.force("link").links(graphData.links);
    // Update collision force with potentially new nodes/radii
    simulation.force("collide").radius(d => calculateNodeRadius(d) + 5); // Update collision radius

    // Restart simulation
    simulation.alpha(1).restart(); // Set alpha to 1 to restart simulation with full energy
}

// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    const lowerWord = word.toLowerCase().trim(); // Use lowercase for canonical ID

    if (!lowerWord) {
        if (!clickedNodeId) { // Only clear and show placeholder if not clicking on a node
             graphData.nodes = [];
             graphData.links = [];
             if (svg) svg.remove(); // Remove SVG if exists
             svg = null; // Reset svg variable
             graphGroup = null; // Reset graphGroup variable
             defs = null; // Reset defs variable
             container.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
        }
        return;
    }

    // Add loading indicator for overall concept fetching
    const existingLoading = container.querySelector('.loading-overlay');
    if(existingLoading) existingLoading.remove();
    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${lowerWord}"...`;
    container.appendChild(loadingOverlay);

    // If it's a new initial exploration from the input box
    if (!clickedNodeId) {
        graphData.nodes = [];
        graphData.links = [];
        // Add the initial node. D3 simulation will position it.
        // Fix center node position based on current dimensions
        updateDimensions(container); // Ensure dimensions are set before fixing center
        // Use lowercase for the center node ID and text, initialize image state
        graphData.nodes.push({ id: lowerWord, text: lowerWord, isCenter: true, fx: centerX, fy: centerY, imageUrl: null, imageLoading: false });
         // Initialize SVG and simulation on the first explore
        initializeGraph(container);
    }
    // Note: If clickedNodeId IS provided, we do NOT clear graphData. We add to it.

    // Find the node for the word being explored (using lowercase ID)
    const exploringNode = graphData.nodes.find(n => n.id === lowerWord);
     if (exploringNode) {
         // Temporarily fix the position of the node being explored
         // Use current position if available, otherwise center
        exploringNode.fx = exploringNode.x || centerX;
        exploringNode.fy = exploringNode.y || centerY;
     }

    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(lowerWord); // Pass lowercase word to AI

    // Remove concept fetching loading indicator
    loadingOverlay.remove();

     // Unfix the exploring node after getting results, unless it's the initial center
    if (exploringNode && !exploringNode.isCenter) {
        exploringNode.fx = null;
        exploringNode.fy = null;
    }

    const nodesToGenerateImagesFor = [];

    // Add new nodes and links to graphData
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();
        const lowerConcept = cleanConcept.toLowerCase(); // Use lowercase for canonical ID

        if (!lowerConcept || lowerConcept === lowerWord) return; // Skip empty, original, or self-referential concepts

        // Add node if it doesn't exist (check using lowercase ID)
        let existingNode = graphData.nodes.find(n => n.id === lowerConcept);
        let targetNode; // Store the node object (existing or new)

        if (!existingNode) {
            // Add new node. Use lowercase for id, original casing for text. Initialize image state.
             targetNode = { id: lowerConcept, text: cleanConcept, parentId: lowerWord, imageUrl: null, imageLoading: false }; // Store original casing in text, lowercase in id
             graphData.nodes.push(targetNode);
             nodesToGenerateImagesFor.push(targetNode); // Add to list for image generation
        } else {
            targetNode = existingNode;
            // If the node exists but doesn't have an image and isn't already loading, generate one
             if (!targetNode.imageUrl && !targetNode.imageLoading) {
                 nodesToGenerateImagesFor.push(targetNode);
             }
        }

        // Add link if it doesn't exist (check using lowercase IDs)
        const linkExists = graphData.links.some(link =>
             // Check if link source/target matches the node IDs
            (link.source.id === lowerWord && link.target.id === lowerConcept) ||
            (link.source.id === lowerConcept && link.target.id === lowerWord)
        );

        if (!linkExists) {
             // Add link using lowercase IDs. D3 force layout will resolve IDs to node objects.
            graphData.links.push({ source: lowerWord, target: lowerConcept });
        }
    });

     // Set initial position for new nodes near their parent for smoother animation
     const parentNode = graphData.nodes.find(n => n.id === lowerWord);
     if (parentNode) {
         nodesToGenerateImagesFor.forEach(newNode => {
             // If the node has no initial position set by the simulation yet,
             // position it near the parent for the start of the transition.
             // This helps nodes animate from near their parent.
             if (newNode.x === undefined) {
                 newNode.x = parentNode.x;
                 newNode.y = parentNode.y;
             }
             // Set loading state before updateGraph for nodes that will get images
             newNode.imageLoading = true;
         });
     }

    // Update the D3 graph representation initially after adding nodes/links
    // This will show the new nodes with their default color or loading state
    updateGraph();

    // Asynchronously generate images for the relevant nodes
    await Promise.all(nodesToGenerateImagesFor.map(async (node) => {
        // Check again if image was already generated or loading finished while waiting
        if (!node.imageUrl && node.imageLoading) {
            const imageUrl = await generateNodeImage(node);
            // Update node data and trigger graph update for this specific node
            node.imageUrl = imageUrl;
            node.imageLoading = false;
            // Re-run updateGraph to apply the image fill
            updateGraph();
        }
    }));

    // Final graph update to ensure everything is settled after all images are attempted
    updateGraph();
}

// Function to programmatically zoom in
function zoomIn() {
    if (svg && zoom) {
        svg.transition().duration(200).call(zoom.scaleBy, 1.2); // Zoom in by 20%
    }
}

// Function to programmatically zoom out
function zoomOut() {
     if (svg && zoom) {
        svg.transition().duration(200).call(zoom.scaleBy, 0.8); // Zoom out by 20%
    }
}

// Function to programmatically pan
function pan(dx, dy) {
    if (svg && zoom) {
        // Get current transform
        const currentTransform = d3.zoomTransform(svg.node());
        // Apply translation
        const newTransform = currentTransform.translate(dx, dy);
        // Apply the new transform to the SVG
        svg.transition().duration(100).call(zoom.transform, newTransform);
    }
}

// Setup function called from script.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea, zoomInButton, zoomOutButton) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        // If graph is empty, initialize it. Otherwise, handleExplore will update.
        // Ensure dimensions are updated before initial graph creation
        if (graphData.nodes.length === 0 && word.trim() !== "") {
             initializeGraph(visualizationArea);
        }
        // Pass original word to handleExplore, it will handle lowercasing internally
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

    // Initial dimensions setup (needed if page loads and simulation isn't started immediately)
    const container = d3.select("#visualizationArea").node();
    if (container) {
        updateDimensions(container);
    }

    // Add zoom button listeners
    zoomInButton.addEventListener('click', zoomIn);
    zoomOutButton.addEventListener('click', zoomOut);

    // Add keyboard listeners for zoom and pan
    window.addEventListener('keydown', (event) => {
        // Prevent default browser zoom for + and - keys
        if (event.key === '+' || event.key === '=' || event.key === '-') {
            event.preventDefault();
        }

        const panAmount = 50; // Amount to pan in pixels

        // Check if the target is the input field, if so, don't pan with arrow keys
        if (event.target === wordInput) {
            return; // Allow normal input behavior
        }

        switch (event.key) {
            case '+':
            case '=':
                zoomIn();
                break;
            case '-':
                zoomOut();
                break;
            case 'ArrowLeft':
                pan(panAmount, 0); // Pan right (positive dx moves graph content right, so view pans left)
                event.preventDefault(); // Prevent page scroll
                break;
            case 'ArrowRight':
                pan(-panAmount, 0); // Pan left (negative dx moves graph content left, so view pans right)
                event.preventDefault(); // Prevent page scroll
                break;
            case 'ArrowUp':
                pan(0, panAmount); // Pan down (positive dy moves graph content down, so view pans up)
                event.preventDefault(); // Prevent page scroll
                break;
            case 'ArrowDown':
                pan(0, -panAmount); // Pan up (negative dy moves graph content up, so view pans down)
                event.preventDefault(); // Prevent page scroll
                break;
            default:
                // Do nothing for other keys
                break;
        }
    });
}