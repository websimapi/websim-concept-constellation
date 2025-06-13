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

// Function to calculate node radius based on text length
function calculateNodeRadius(d) {
     // Base radius + radius per character + buffer for collision and text visibility
     // Increased base and multiplier slightly for better text visibility over images
     return Math.max(30, 20 + (d.text ? d.text.length : 0) * 3.5) + 5; // Added 5px buffer
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

// Function to generate and assign image URL to a node
async function generateAndAssignImage(node) {
    if (!node || !node.text) {
        return; // Cannot generate image without text
    }

    try {
        const result = await websim.imageGen({
            prompt: node.text + ", abstract concept art", // Use node text for prompt, add style hint
            transparent: false, // Want a background image
            aspect_ratio: "1:1" // Square is good for clipping to a circle
        });

        if (result && result.url) {
            node.imageUrl = result.url;
            node.imageLoading = false;
            node.imageError = false; // Clear any previous error

            // Trigger a graph update to render the image for this node
            // Update only the specific node's pattern and circle fill
            updateNodeImage(node.id);

        } else {
            console.warn(`Image generation failed for "${node.text}". No URL returned.`);
            node.imageLoading = false;
            node.imageError = true; // Mark as error
             updateNodeImage(node.id); // Update to show error state
        }

    } catch (error) {
        console.error(`Error generating image for "${node.text}":`, error);
        node.imageLoading = false;
        node.imageError = true; // Mark as error
        updateNodeImage(node.id); // Update to show error state
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

    // Insert <defs> element at the beginning of the SVG
    svg.insert("defs", ":first-child");

    // Create a group for the graph elements (nodes and links) that will be zoomed/panned
    graphGroup = svg.append("g");

    // Initialize force simulation
    simulation = d3.forceSimulation(graphData.nodes)
        // Increase distance for more spacing between linked nodes
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150)) // Increased distance from 100 to 150
        .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion
        .force("center", d3.forceCenter(centerX, centerY)) // Center force (use dynamic center)
        // Add collision force to prevent node overlap
        .force("collide", d3.forceCollide().radius(d => calculateNodeRadius(d) + 2).iterations(2)); // Use dynamic radius function + a little extra buffer

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
    if (!svg || !graphGroup || !container) { // Check for graphGroup existence
        console.error("SVG, graphGroup, or container not initialized before updating graph.");
        return;
    }

    // Ensure dimensions are up-to-date before updating graph elements
    updateDimensions(container);

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


    // --- Update Patterns (within defs) ---
    // Ensure defs exists (it should be created in initializeGraph, but belt and suspenders)
    const defs = svg.select("defs");
    if (defs.empty()) {
         svg.insert("defs", ":first-child");
    }

    // Data join for patterns - ensures patterns exist for all current nodes
    const patterns = svg.select("defs").selectAll("pattern")
        .data(graphData.nodes, d => d.id) // Pattern ID linked to node ID
        .join(
            enter => {
                 const pattern = enter.append("pattern")
                     .attr("id", d => `pattern-${d.id}`)
                     .attr("patternUnits", "userSpaceOnUse")
                     // Use radius for pattern size (matches symptom, covers 1/4 if origin is center)
                     .attr("width", d => calculateNodeRadius(d))
                     .attr("height", d => calculateNodeRadius(d));

                 // Background rect for loading/error state
                 pattern.append("rect")
                      // Position at 0,0 within pattern area (covers 1/4 if pattern size is radius)
                     .attr("x", 0)
                     .attr("y", 0)
                     // Size matches pattern size (radius x radius)
                     .attr("width", d => calculateNodeRadius(d))
                     .attr("height", d => calculateNodeRadius(d))
                     .attr("fill", "#eee"); // Default gray background

                 // Image element (initially hidden)
                 pattern.append("image")
                      // Position at 0,0 within pattern area (covers 1/4 if pattern size is radius)
                     .attr("x", 0)
                     .attr("y", 0)
                     // Size matches pattern size (radius x radius)
                     .attr("width", d => calculateNodeRadius(d))
                     .attr("height", d => calculateNodeRadius(d))
                     .attr("preserveAspectRatio", "xMidYMid slice")
                     .attr("href", null); // Start with no image URL

                 // Loading/Error text - Keep positioned at 0,0 (center of circle if pattern origin is circle center)
                  pattern.append("text")
                      .attr("x", 0)
                      .attr("y", 0)
                      .attr("dy", "0.35em")
                      .attr("text-anchor", "middle")
                      .attr("fill", "#555")
                      .style("font-size", "10px") // Smaller font
                      .style("pointer-events", "none")
                      .style("user-select", "none")
                      .text(d => d.imageLoading ? "Loading..." : (d.imageError ? "Error" : "")); // Set initial text


                 return pattern;
            },
            update => {
                const radius = calculateNodeRadius(d);
                 // Update pattern dimensions (if radius changed) - using radius, matches symptom
                update.attr("width", radius)
                      .attr("height", radius);

                // Update background rect size/position and color - using radius, matches symptom
                 update.select("rect")
                     .attr("x", 0)
                     .attr("y", 0)
                     .attr("width", radius)
                     .attr("height", radius)
                     .attr("fill", d => d.imageError ? "#fdd" : "#eee"); // Red background on error

                // Update image href and opacity - using radius, matches symptom
                update.select("image")
                    .attr("x", 0)
                    .attr("y", 0)
                    .attr("width", radius)
                    .attr("height", radius)
                    .attr("href", d => d.imageUrl ? d.imageUrl : null) // Set or update image URL
                    // Fade in image if loaded and not loading/errored
                    .transition().duration(500)
                    .style("opacity", d => d.imageUrl && !d.imageLoading && !d.imageError ? 1 : 0);

                // Update loading text content and visibility - position is 0,0
                 update.select("text")
                     .text(d => d.imageLoading ? "Loading..." : (d.imageError ? "Error" : "")) // Update text content
                     .style("opacity", d => d.imageLoading || d.imageError ? 1 : 0); // Show if loading or error

                return update;
            },
            exit => exit.remove() // Remove patterns for exiting nodes
        );


    // --- Update Nodes (within graphGroup) ---
    nodeElements = graphGroup.select(".nodes").selectAll(".node")
        .data(graphData.nodes, d => d.id) // Data join with key (using lowercase ID)
        .join(
            enter => {
                 const group = enter.append("g")
                     .attr("class", d => d.isCenter ? "center-node node" : "concept-node node")
                     // Initial position for animation
                     .attr("transform", d => `translate(${d.x || centerX},${d.y || centerY})`)
                     .style("opacity", 0); // Start transparent for fade-in

                 // Add circle, filled with the corresponding pattern
                 group.append("circle")
                     .attr("r", calculateNodeRadius) // Use the radius calculation function
                     .attr("cx", 0) // Explicitly center the circle within the group
                     .attr("cy", 0) // Explicitly center the circle within the group
                     .attr("fill", d => `url(#pattern-${d.id})`); // Reference the node's pattern

                 // Add text (overlayed on the image/pattern)
                 group.append("text")
                     .text(d => d.text) // Use node's text property (lowercase)
                     .attr("x", 0)
                     .attr("y", 0)
                     .attr("dy", "0.35em")
                     .attr("text-anchor", "middle")
                     .style("pointer-events", "none")
                     .style("user-select", "none")
                     // Add stroke/shadow to make text visible on busy backgrounds
                     .style("stroke", "black") // Black stroke
                     .style("stroke-width", 1) // Thin stroke
                     .style("paint-order", "stroke") // Draw stroke first, then fill
                     .attr("fill", "white"); // White fill text color


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


                 // Animate fade-in for the whole node group
                 group.transition().duration(500).style("opacity", 1);

                 return group;
             },
            update => {
                // Update existing node groups
                 update.select("circle")
                     .attr("r", calculateNodeRadius) // Re-calculate radius if text changed (unlikely with lowercase)
                      .attr("cx", 0) // Ensure explicit centering
                      .attr("cy", 0) // Ensure explicit centering
                     .attr("fill", d => `url(#pattern-${d.id})`); // Ensure fill is correctly referencing the pattern

                 // Update text content (unlikely here with lowercase)
                 update.select("text").text(d => d.text);
                 // Keep stroke/fill styles from enter selection or reapply if needed

                // No need to re-apply drag or click listeners, they are attached to the group on enter
                return update;
             },
            exit => exit.transition().duration(500).style("opacity", 0).remove() // Fade out and remove
        );


    // Update simulation nodes and links
    simulation.nodes(graphData.nodes);
    simulation.force("link").links(graphData.links);
    // Update collision force with potentially new nodes/radii
    simulation.force("collide").radius(d => calculateNodeRadius(d) + 2); // Use updated radius for collision

    // Restart simulation
    simulation.alpha(1).restart(); // Set alpha to 1 to restart simulation with full energy
}

// Function to update just a single node's image/pattern state after image loads/errors
function updateNodeImage(nodeId) {
     const node = graphData.nodes.find(n => n.id === nodeId);
     if (!node) return;

     const pattern = svg.select("defs").select(`#pattern-${nodeId}`);
     const nodeGroup = graphGroup.select(".nodes").select(`.node[data-id="${nodeId}"]`); // Assuming nodes have data-id

      // Add a data-id attribute to the node group in the join 'enter' selection
      // so we can select it reliably here.
      // In updateGraph, inside join(enter => ...)
      // group.attr("data-id", d => d.id);


     if (!pattern.empty()) {
         const radius = calculateNodeRadius(node);
         // Update pattern elements based on the node's current state (imageUrl, imageLoading, imageError)
         pattern.select("rect")
             .attr("fill", node.imageError ? "#fdd" : "#eee");

         pattern.select("image")
             .attr("href", node.imageUrl ? node.imageUrl : null)
             .transition().duration(500)
             .style("opacity", node.imageUrl && !node.imageLoading && !node.imageError ? 1 : 0);

         pattern.select("text")
             .text(node.imageLoading ? "Loading..." : (node.imageError ? "Error" : ""))
             .style("opacity", node.imageLoading || node.imageError ? 1 : 0);

         // Although pattern size is based on radius, let's ensure it's updated just in case
         pattern
              .attr("width", radius)
              .attr("height", radius);
         pattern.select("rect")
              .attr("width", radius)
              .attr("height", radius);
         pattern.select("image")
              .attr("width", radius)
              .attr("height", radius);
     }
      // Re-bind data to node groups if needed for attribute updates, although fill is on the circle inside
     if (!nodeGroup.empty()) {
          // No need to re-select circle inside, pattern update is enough for fill
          // However, if radius changed significantly, need to update the circle's 'r'
          // The updateGraph already handles this for all nodes.
          // This specific function only updates the pattern content state.
     }

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
        // Add the initial node. Use lowercase for ID, original case for display text.
        // Fix center node position based on current dimensions
        updateDimensions(container); // Ensure dimensions are set before fixing center
        const centerNode = { id: lowerWord, text: word.trim(), isCenter: true, fx: centerX, fy: centerY, imageLoading: true };
        graphData.nodes.push(centerNode);

         // Initialize SVG and simulation on the first explore
        initializeGraph(container);
        updateGraph(); // Initial draw with loading state visible for the center node

        // Generate image for center node asynchronously
        generateAndAssignImage(centerNode);

    } else {
        // If clicking an existing node, find it to temporarily fix position
        const exploringNode = graphData.nodes.find(n => n.id === lowerWord);
         if (exploringNode) {
             // Temporarily fix the position of the node being explored
             // Use current position if available, otherwise center
            exploringNode.fx = exploringNode.x || centerX;
            exploringNode.fy = exploringNode.y || centerY;
            // Add loading state to the clicked node's pattern/image
             exploringNode.imageLoading = true;
             exploringNode.imageError = false; // Clear previous error if any
             updateNodeImage(exploringNode.id);
         }
    }


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(lowerWord); // Pass lowercase word to AI

    // Remove loading indicator after AI call
    loadingOverlay.remove();

    // Unfix the exploring node after getting results, unless it's the initial center
    const exploringNode = graphData.nodes.find(n => n.id === lowerWord); // Find again in case it was just added
    if (exploringNode && !exploringNode.isCenter) {
        exploringNode.fx = null;
        exploringNode.fy = null;
         // Remove loading state from the clicked node's pattern/image
         exploringNode.imageLoading = false; // Assume success or error handled below
         updateNodeImage(exploringNode.id);
    }


    // Add new nodes and links to graphData
    const parentNode = graphData.nodes.find(n => n.id === lowerWord);
    const newNodesToAdd = []; // Keep track of brand new nodes

    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();
        const lowerConcept = cleanConcept.toLowerCase(); // Use lowercase for canonical ID

        if (!lowerConcept) return; // Skip empty lowercase concepts

        // Add node if it doesn't exist (check using lowercase ID)
        const existingNode = graphData.nodes.find(n => n.id === lowerConcept);
        let targetNode; // Store the node object (existing or new)

        if (!existingNode) {
            // Add new node. Use lowercase for id, original case for display text.
             targetNode = {
                 id: lowerConcept,
                 text: cleanConcept, // Store cleaned version for display
                 parentId: lowerWord,
                 imageLoading: true // Mark for image loading
             };
             graphData.nodes.push(targetNode);
             newNodesToAdd.push(targetNode); // This node needs image generation
        } else {
            targetNode = existingNode; // Node already exists
            // If an existing node was clicked, but its image failed, retry? Or only retry if user explicitly asks?
            // For now, only generate for brand new nodes.
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

     // Set initial position for brand new nodes near their parent for smoother animation
     // And trigger image generation for these new nodes
     if (parentNode) {
         newNodesToAdd.forEach(newNode => {
             if (newNode.x === undefined) {
                 newNode.x = parentNode.x;
                 newNode.y = parentNode.y;
             }
             // Trigger image generation for newly added nodes
             generateAndAssignImage(newNode); // Async call
         });
     }

    // Update the D3 graph representation to show new nodes (with loading state) and links
    updateGraph();

    // No need for clicked node feedback if no new concepts added, the graph just won't change.
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
             // initializeGraph will be called inside handleExplore for the first time
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
        // Call updateDimensions even if initializeGraph isn't called immediately,
        // socenterX/centerY are set correctly if a word is entered later.
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

        // Check if input field is focused, ignore keyboard controls if so
        if (wordInput === document.activeElement) {
            return;
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