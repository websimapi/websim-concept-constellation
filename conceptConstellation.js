import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

// D3 variables
let svg;
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

// Function to calculate node radius based on text length - adjusted slightly for image
function calculateNodeRadius(d) {
     // Use the same logic as the circle radius, adding a small buffer for collision
     // Ensure d.text exists before accessing length
     // Added padding for image inside circle
     const baseRadius = 25;
     const textPadding = 15; // Space for text length influence
     const collisionBuffer = 5; // Buffer for collision detection

     // Node radius should be large enough for text, or a base size for image
     const radius = Math.max(baseRadius, textPadding + (d.text ? d.text.length : 0) * 3);

     // Add collision buffer
     return radius + collisionBuffer;
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

// Function to generate image for a node and update graph
async function generateAndSetNodeImage(node, container) {
     // Only generate if the node doesn't already have an image URL
    if (node && !node.imageUrl) {
        try {
            // Add a loading indicator *on the node* if possible? Or perhaps just show text until image loads.
            // For now, the global loading overlay is sufficient during initial load.
            // After initial load, the node will appear with text, and then the image will replace it when ready.

            const prompt = node.text || node.id; // Use text or id as prompt
            const imageResult = await websim.imageGen({
                prompt: `${prompt}, simple illustration`, // Add context for simpler images
                aspect_ratio: "1:1", // Square for easy fitting
                transparent: false, // Non-transparent fills the circle better
                width: 128, // Smaller images are faster and sufficient for node icons
                height: 128
            });

            if (imageResult && imageResult.url) {
                // Update the node data with the image URL
                node.imageUrl = imageResult.url;
                 // Force an update of this specific node element
                updateNodeAppearance(node);
            } else {
                console.warn(`Failed to generate image for "${prompt}"`);
                 // Optionally, flag the node so we don't try again
                 node.imageUrl = 'error'; // Use a special value to indicate failed attempt
                 // Keep text visible for this node if image failed
                  updateNodeAppearance(node); // Ensure text becomes visible if image fails
            }

        } catch (error) {
            console.error(`Error generating image for "${node.text || node.id}":`, error);
            node.imageUrl = 'error'; // Flag failure
             // Keep text visible for this node
             updateNodeAppearance(node); // Ensure text becomes visible if image fails
        }
    }
}

// Function to specifically update the appearance of a single node based on data (image/text)
function updateNodeAppearance(node) {
    const nodeElement = d3.select(`#visualizationArea svg .nodes .node[data-id="${node.id}"]`); // Select node group by data-id
    if (!nodeElement.empty()) {
        const radius = calculateNodeRadius(node) - 5; // Get circle radius (subtract buffer)

        // Update image element
        nodeElement.select("image")
            .attr("href", node.imageUrl && node.imageUrl !== 'error' ? node.imageUrl : null) // Set href if valid URL
            .attr("x", node.imageUrl && node.imageUrl !== 'error' ? -radius : 0) // Position image centered
            .attr("y", node.imageUrl && node.imageUrl !== 'error' ? -radius : 0)
            .attr("width", node.imageUrl && node.imageUrl !== 'error' ? radius * 2 : 0) // Size image to fit circle
            .attr("height", node.imageUrl && node.imageUrl !== 'error' ? radius * 2 : 0)
            .style("display", node.imageUrl && node.imageUrl !== 'error' ? "block" : "none"); // Show/hide image


        // Update text element
         nodeElement.select("text")
             .style("opacity", node.imageUrl && node.imageUrl !== 'error' ? 0 : 1); // Hide text if image is shown, show if not or if image failed

         // Re-apply drag behavior in case this node wasn't part of initial drag application? (Might not be necessary here)
         // nodeElement.call(d3.select("#visualizationArea svg")._dragBehavior);
    } else {
        // Node element not found, will be handled by full updateGraph later
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

     // Add definitions for clip paths etc.
    const defs = svg.append("defs");

    // Create a circular clip path for nodes
    defs.append("clipPath")
        .attr("id", "node-clip") // Unique ID for the clip path
        .append("circle")
        // Circle for clipping will be sized and positioned based on node radius later via D3 updates
        // Use radius of 1 for now, it will be updated by D3
        .attr("r", 1);

    // Create a group for the graph elements (nodes and links) that will be zoomed/panned
    graphGroup = svg.append("g");

    // Initialize force simulation
    simulation = d3.forceSimulation(graphData.nodes)
        // Increase distance for more spacing between linked nodes
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150)) // Increased distance from 100 to 150
        .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion
        .force("center", d3.forceCenter(centerX, centerY)) // Center force (use dynamic center)
        // Add collision force to prevent node overlap
        .force("collide", d3.forceCollide().radius(calculateNodeRadius).iterations(2)); // Use dynamic radius function

    // Create group for links (will be appended first to be underneath)
    linkElements = graphGroup.append("g").attr("class", "links").selectAll(".relation-line");

    // Create group for nodes (will be appended second to be on top)
    nodeElements = graphGroup.append("g").attr("class", "nodes").selectAll(".node"); // Group for nodes (circle + text + image)

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
    if (!svg || !graphGroup || !container) { // Check for graphGroup existence
        console.error("SVG, graphGroup, or container not initialized before updating graph.");
        return;
    }

    // Ensure dimensions are up-to-date before updating graph elements
    updateDimensions(container);

    // Select links within the graphGroup (within the 'links' group if it exists)
    // Using selectAll again re-selects based on the data.
    // The join method handles adding/removing/updating elements within the selection's parent.
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


    // Select nodes within the graphGroup (within the 'nodes' group if it exists)
    nodeElements = graphGroup.select(".nodes").selectAll(".node")
        .data(graphData.nodes, d => d.id) // Data join with key (using lowercase ID)
        .join(
            enter => {
                 const group = enter.append("g")
                     .attr("class", d => d.isCenter ? "center-node node" : "concept-node node")
                     .attr("data-id", d => d.id) // Add data attribute for easy selection
                     // Initial position for animation (optional: could be parent position)
                     // Force layout will position them afterwards. Use dynamic center for initial position.
                     // The initial position is set in handleExplore for new nodes
                     .attr("transform", d => `translate(${d.x || centerX},${d.y || centerY})`)
                     .style("opacity", 0); // Start transparent for fade-in

                 // Add circle
                 group.append("circle")
                     .attr("r", calculateNodeRadius); // Use the radius calculation function

                 // Add image placeholder - position and size will be updated
                 group.append("image")
                      .attr("xlink:href", null) // Will be set later by generateAndSetNodeImage
                      .attr("x", 0).attr("y", 0).attr("width", 0).attr("height", 0) // Initial state
                      .attr("preserveAspectRatio", "xMidYMid slice"); // Scale and crop to fill circle

                 // Add text
                 group.append("text")
                     .text(d => d.text) // Use node's text property (lowercase)
                     .attr("x", 0)
                     .attr("y", 0)
                     .attr("dy", "0.35em")
                     .attr("text-anchor", "middle")
                     .style("pointer-events", "none")
                     .style("user-select", "none")
                     .style("opacity", 1); // Text is visible initially until image loads


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
                     .attr("r", calculateNodeRadius); // Re-calculate radius in case text changed (unlikely here with lowercase)

                // Update text and image visibility/attributes
                 update.select("text")
                      .text(d => d.text) // Update text (unlikely here with lowercase)
                      .style("opacity", d => d.imageUrl && d.imageUrl !== 'error' ? 0 : 1); // Hide text if image exists, show if not or failed

                 update.select("image")
                     .attr("xlink:href", d => d.imageUrl && d.imageUrl !== 'error' ? d.imageUrl : null)
                     .attr("x", d => {
                         const r = calculateNodeRadius(d) - 5; // Use calculated radius minus buffer
                         return d.imageUrl && d.imageUrl !== 'error' ? -r : 0;
                     })
                     .attr("y", d => {
                         const r = calculateNodeRadius(d) - 5;
                         return d.imageUrl && d.imageUrl !== 'error' ? -r : 0;
                     })
                     .attr("width", d => {
                         const r = calculateNodeRadius(d) - 5;
                         return d.imageUrl && d.imageUrl !== 'error' ? r * 2 : 0;
                     })
                     .attr("height", d => {
                         const r = calculateNodeRadius(d) - 5;
                         return d.imageUrl && d.imageUrl !== 'error' ? r * 2 : 0;
                     })
                     .style("display", d => d.imageUrl && d.imageUrl !== 'error' ? "block" : "none");


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
    const lowerWord = word.toLowerCase().trim(); // Use lowercase for canonical ID

    if (!lowerWord) {
        if (!clickedNodeId) { // Only clear and show placeholder if not clicking on a node
             graphData.nodes = [];
             graphData.links = [];
             if (svg) svg.remove(); // Remove SVG if exists
             svg = null; // Reset svg variable
             graphGroup = null; // Reset graphGroup variable
             container.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
        }
        return;
    }

    // Add loading indicator
    // Remove any existing loading indicator first
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
        // Use lowercase for the center node ID and text
        const centerNode = { id: lowerWord, text: lowerWord, isCenter: true, fx: centerX, fy: centerY };
        graphData.nodes.push(centerNode);
         // Initialize SVG and simulation on the first explore
        initializeGraph(container);

        // Generate image for the center node immediately
        generateAndSetNodeImage(centerNode, container);

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

    // Remove loading indicator after AI call
    loadingOverlay.remove();

     // Unfix the exploring node after getting results, unless it's the initial center
    if (exploringNode && !exploringNode.isCenter) {
        exploringNode.fx = null;
        exploringNode.fy = null;
    }


    // Add new nodes and links to graphData
    const newNodes = [];
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();
        const lowerConcept = cleanConcept.toLowerCase(); // Use lowercase for canonical ID

        if (!lowerConcept) return; // Skip empty lowercase concepts

        // Add node if it doesn't exist (check using lowercase ID)
        const existingNode = graphData.nodes.find(n => n.id === lowerConcept);
        let targetNode; // Store the node object (existing or new)

        if (!existingNode) {
            // Add new node. Use lowercase for id and text.
             targetNode = { id: lowerConcept, text: cleanConcept, parentId: lowerWord }; // Keep parentId as lowercase, use original casing for text? Or maybe lowercase text too for consistency? Let's use original casing for text displayed, lowercase for id.
             graphData.nodes.push(targetNode);
             newNodes.push(targetNode); // Keep track of newly added nodes
        } else {
            targetNode = existingNode;
        }

        // Add link if it doesn't exist (check using lowercase IDs)
        const linkExists = graphData.links.some(link =>
            // Ensure source and target are node objects from the simulation or node IDs
            // D3-force handles resolving string IDs to objects if 'id' is specified for the link force
            (link.source === lowerWord && link.target === lowerConcept) ||
            (link.source === lowerConcept && link.target === lowerWord) ||
            (link.source.id === lowerWord && link.target.id === lowerConcept) || // Check if already objects
            (link.source.id === lowerConcept && link.target.id === lowerWord)
        );

        if (!linkExists) {
            // Add link using lowercase IDs
            graphData.links.push({ source: lowerWord, target: lowerConcept });
        }
    });

     // Set initial position for new nodes near their parent for smoother animation
     const parentNode = graphData.nodes.find(n => n.id === lowerWord);
     if (parentNode) {
         newNodes.forEach(newNode => {
             // If the node has no initial position set by the simulation yet,
             // position it near the parent for the start of the transition.
             // This helps nodes animate from near their parent.
             if (newNode.x === undefined && parentNode.x !== undefined) { // Only set if parent has coords
                 newNode.x = parentNode.x + (Math.random() - 0.5) * 50; // Slight random offset
                 newNode.y = parentNode.y + (Math.random() - 0.5) * 50; // Slight random offset
             }
             // Also trigger image generation for new nodes
             generateAndSetNodeImage(newNode, container);
         });
     }

    // Update the D3 graph representation
    updateGraph();

    // If no new concepts were added and it was an exploration click, provide feedback?
    // This is still tricky with incremental updates. For now, rely on the graph not changing.
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
             // Initialization now happens inside handleExplore if graph is empty
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