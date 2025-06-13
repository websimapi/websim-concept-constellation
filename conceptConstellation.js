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

    // Only generate if image hasn't been generated and isn't currently loading/errored
    if (node.imageUrl || node.imageLoading || node.imageError) {
        return;
    }

    // Mark node as loading and update graph to show loading text
    node.imageLoading = true;
    node.imageError = false; // Clear any previous error
    updateGraph(); // Update to show loading state

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
            updateGraph();

        } else {
            console.warn(`Image generation failed for "${node.text}". No URL returned.`);
            node.imageLoading = false;
            node.imageError = true; // Mark as error
            updateGraph(); // Update to show error state
        }

    } catch (error) {
        console.error(`Error generating image for "${node.text}":`, error);
        node.imageLoading = false;
        node.imageError = true; // Mark as error
        updateGraph(); // Update to show error state
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

        // Update pattern positions inside defs - this is crucial if pattern units were objectBoundingBox,
        // but with userSpaceOnUse positioned relative to the circle's center,
        // the position should already be relative to the translating group.
        // However, let's ensure the patterns themselves get updated during the tick
        // or whenever radius changes. updateGraph handles this.
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
                    // Set pattern size based on current radius (diameter)
                    .attr("width", d => calculateNodeRadius(d) * 2)
                    .attr("height", d => calculateNodeRadius(d) * 2)
                    // Position the pattern origin at the center of the circle (0,0) in userSpaceOnUse relative to element)
                    // and shift the content within the pattern to cover the area from -r to +r
                    .attr("patternContentUnits", "userSpaceOnUse");


                // Background rect for loading/error state or simply behind the image
                // Position at -r, -r and cover the full pattern area (2r x 2r)
                pattern.append("rect")
                     .attr("x", d => -calculateNodeRadius(d)) // Corrected position
                     .attr("y", d => -calculateNodeRadius(d)) // Corrected position
                     .attr("width", d => calculateNodeRadius(d) * 2)
                     .attr("height", d => calculateNodeRadius(d) * 2)
                     // Set initial fill - will be updated
                     .attr("fill", "#eee"); // Default gray background

                // Image element - Position at -r, -r and cover the full pattern area (2r x 2r)
                pattern.append("image")
                    .attr("x", d => -calculateNodeRadius(d)) // Corrected position
                    .attr("y", d => -calculateNodeRadius(d)) // Corrected position
                    .attr("width", d => calculateNodeRadius(d) * 2)
                    .attr("height", d => calculateNodeRadius(d) * 2)
                    .attr("preserveAspectRatio", "xMidYMid slice") // Scale and crop to fill
                    .attr("href", null) // Start with no image URL
                    .style("opacity", 0); // Start hidden

                // Loading/Error text - Position in the center of the pattern area (which is 0,0 with patternContentUnits set to userSpaceOnUse on the circle element)
                 pattern.append("text")
                     .attr("x", 0) // Center X
                     .attr("y", 0) // Center Y
                     .attr("dy", "0.35em") // Vertical align tweak
                     .attr("text-anchor", "middle")
                     .attr("fill", "#555")
                     .style("font-size", "10px") // Smaller font
                     .style("pointer-events", "none")
                     .style("user-select", "none")
                     .text(d => d.imageLoading ? "Loading..." : (d.imageError ? "Error" : "")); // Set initial text


                return pattern;
            },
            update => {
                // Update pattern dimensions (if radius changed)
                update.attr("width", d => calculateNodeRadius(d) * 2)
                      .attr("height", d => calculateNodeRadius(d) * 2);

                // Update background rect size/position and color
                 update.select("rect")
                     .attr("x", d => -calculateNodeRadius(d)) // Ensure correct position
                     .attr("y", d => -calculateNodeRadius(d)) // Ensure correct position
                     .attr("width", d => calculateNodeRadius(d) * 2)
                     .attr("height", d => calculateNodeRadius(d) * 2)
                     .attr("fill", d => d.imageError ? "#fdd" : "#eee"); // Red background on error or grey

                // Update image href and opacity, ensuring correct position and size
                update.select("image")
                    .attr("x", d => -calculateNodeRadius(d)) // Ensure correct position
                    .attr("y", d => -calculateNodeRadius(d)) // Ensure correct position
                    .attr("width", d => calculateNodeRadius(d) * 2)
                    .attr("height", d => calculateNodeRadius(d) * 2)
                    .attr("href", d => d.imageUrl ? d.imageUrl : null) // Set or update image URL
                    // Fade in image if loaded and not loading/errored
                    .transition().duration(500)
                    .style("opacity", d => d.imageUrl && !d.imageLoading && !d.imageError ? 1 : 0);

                // Update loading text position (should be 0,0 relative to pattern/circle center) and content/visibility
                 update.select("text")
                     .attr("x", 0) // Ensure correct position
                     .attr("y", 0) // Ensure correct position
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


    // Find or create the central node for this exploration
    let centralNode = graphData.nodes.find(n => n.id === lowerWord);

    // If it's a new initial exploration from the input box OR if the node doesn't exist yet
    if (!clickedNodeId || !centralNode) {
         // If it's a new exploration from the input box, clear the existing graph
         if (!clickedNodeId) {
            graphData.nodes = [];
            graphData.links = [];
            // Initialize SVG and simulation on the first explore
            initializeGraph(container);
         }

        // Add the initial/central node if it doesn't exist.
        // Use lowercase for ID, original case for display text.
        if (!centralNode) {
            // Fix center node position based on current dimensions
            updateDimensions(container); // Ensure dimensions are set before fixing center
            centralNode = { id: lowerWord, text: word.trim(), isCenter: !clickedNodeId, fx: centerX, fy: centerY };
            graphData.nodes.push(centralNode);
             // Mark for image loading
            centralNode.imageLoading = true;
            // Trigger image generation for the central node asynchronously
            generateAndAssignImage(centralNode);
        } else {
             // If node already exists (e.g., clicked from somewhere else but becoming "central" for this explore action)
             // Ensure its position is fixed temporarily
             centralNode.fx = centralNode.x || centerX;
             centralNode.fy = centralNode.y || centerY;
             // If image failed previously, maybe try generating again?
             if (!centralNode.imageUrl && !centralNode.imageLoading) {
                 centralNode.imageLoading = true;
                 generateAndAssignImage(centralNode); // Trigger image generation
                 updateGraph(); // Show loading state
             }
        }

        // Update the graph to show the central node (with loading state)
        updateGraph(); // Initial draw with loading state visible for the center node

    } else {
        // If clicking an existing node, find it to temporarily fix position
         // Use current position if available, otherwise center
        centralNode.fx = centralNode.x || centerX;
        centralNode.fy = centralNode.y || centerY;
         // If image failed previously, maybe try generating again?
         if (!centralNode.imageUrl && !centralNode.imageLoading) {
             centralNode.imageLoading = true;
             generateAndAssignImage(centralNode); // Trigger image generation
             updateGraph(); // Show loading state
         }
    }


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(lowerWord); // Pass lowercase word to AI

    // Remove loading indicator after AI call
    loadingOverlay.remove();

    // Unfix the exploring node after getting results, unless it's the initial center
    if (centralNode && !centralNode.isCenter) {
        centralNode.fx = null;
        centralNode.fy = null;
    }


    // Add new nodes and links to graphData
    const newNodesToAdd = []; // Keep track of brand new nodes

    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();
        const lowerConcept = cleanConcept.toLowerCase(); // Use lowercase for canonical ID

        if (!lowerConcept || lowerConcept === lowerWord) return; // Skip empty or self-referencing concepts

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
            // If an existing node was clicked and its image failed, retry generating
             if (!targetNode.imageUrl && !targetNode.imageLoading && targetNode.imageError) {
                targetNode.imageError = false; // Clear error state
                targetNode.imageLoading = true; // Mark for retry
                 newNodesToAdd.push(targetNode); // Add to list to retry image gen
             }
        }

        // Add link if it doesn't exist between the central node and the target node
        const linkExists = graphData.links.some(link => {
            // Check using node objects or string IDs, accounting for source/target order
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            return (sourceId === lowerWord && targetId === lowerConcept) ||
                   (sourceId === lowerConcept && targetId === lowerWord);
        });


        if (!linkExists) {
            // Add link using lowercase IDs
            graphData.links.push({ source: lowerWord, target: lowerConcept });
        }
    });

     // Set initial position for brand new nodes near their parent for smoother animation
     // And trigger image generation for these new nodes
     if (centralNode) { // Use centralNode (the node being explored from)
         newNodesToAdd.forEach(newNode => {
             // Only set initial position if it hasn't been set by simulation or drag
             if (newNode.x === undefined) {
                 // Position new nodes near the central node with a slight random offset
                 newNode.x = centralNode.x + (Math.random() - 0.5) * 50;
                 newNode.y = centralNode.y + (Math.random() - 0.5) * 50;
             }
             // Trigger image generation for nodes added or needing retry
             generateAndAssignImage(newNode); // Async call
         });
     }

    // Update the D3 graph representation to show new nodes (with loading state) and links
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