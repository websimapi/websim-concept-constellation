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

// Function to calculate node radius based on text length (visual radius)
function calculateNodeRadius(d) {
     // Ensure d.text exists before accessing length
     return Math.max(25, 15 + (d.text ? d.text.length : 0) * 3);
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

    // Create a group for the graph elements (nodes and links) that will be zoomed/panned
    graphGroup = svg.append("g");

     // Add defs section for patterns
     svg.insert("defs", ":first-child");


    // Initialize force simulation
    simulation = d3.forceSimulation(graphData.nodes)
        // Increase distance for more spacing between linked nodes
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150)) // Increased distance from 100 to 150
        .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion
        .force("center", d3.forceCenter(centerX, centerY)) // Center force (use dynamic center)
        // Add collision force to prevent node overlap, use radius + buffer
        .force("collide", d3.forceCollide().radius(d => calculateNodeRadius(d) + 5).iterations(2));

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

    // --- Handle Patterns in defs ---
    const defs = svg.select("defs");

    // Bind pattern data to nodes that *have* an image URL
    const patternElements = defs.selectAll("pattern")
        .data(graphData.nodes.filter(d => d.imageUrl), d => d.id); // Key by node ID

    // Enter patterns
    const enterPatterns = patternElements.enter().append("pattern")
        .attr("id", d => `pattern-${d.id}`) // Unique ID
        .attr("patternUnits", "userSpaceOnUse")
        // Size based on the node's calculated radius (diameter)
        .attr("width", d => calculateNodeRadius(d) * 2)
        .attr("height", d => calculateNodeRadius(d) * 2);

    // Append image to entering patterns
    enterPatterns.append("image")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", d => calculateNodeRadius(d) * 2) // Image size matches pattern size
        .attr("height", d => calculateNodeRadius(d) * 2)
        .attr("href", d => d.imageUrl); // Set the image source (using href for modern SVG)

    // Update patterns (if image URL or radius changes)
    patternElements
         .attr("width", d => calculateNodeRadius(d) * 2) // Update pattern size
         .attr("height", d => calculateNodeRadius(d) * 2);
    patternElements.select("image")
         .attr("width", d => calculateNodeRadius(d) * 2) // Update image size
         .attr("height", d => calculateNodeRadius(d) * 2)
         .attr("href", d => d.imageUrl); // Update image source

    // Exit patterns
    patternElements.exit().remove();


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
                     // Initial position for animation (optional: could be parent position)
                     // Force layout will position them afterwards. Use dynamic center for initial position.
                     // The initial position is set in handleExplore for new nodes
                     .attr("transform", d => `translate(${d.x || centerX},${d.y || centerY})`)
                     .style("opacity", 0); // Start transparent for fade-in

                 // Add circle
                 group.append("circle")
                     .attr("r", calculateNodeRadius) // Use the radius calculation function (visual radius)
                     // Set initial fill: default color or loading grey
                     .attr("fill", d => d.isGeneratingImage ? "#ddd" : (d.isCenter ? "#28a745" : "#007bff"));


                 // Add text label (always text)
                 group.append("text")
                     .text(d => d.text) // Use node's text property (lowercase)
                     .attr("x", 0)
                     .attr("y", 0)
                     .attr("dy", "0.35em")
                     .attr("text-anchor", "middle")
                     .style("fill", "#fff") // Keep text white
                     .style("font-size", d => d.isCenter ? "14px" : "12px")
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
                     .attr("r", calculateNodeRadius) // Re-calculate radius if needed
                     // Update fill based on state (image, loading, or default)
                     .transition().duration(200) // Add a small transition for fill changes
                     .attr("fill", d => {
                        if (d.imageUrl) {
                            return `url(#pattern-${d.id})`; // Use pattern fill if image available
                        } else if (d.isGeneratingImage) {
                            return "#ddd"; // Use loading grey if generating
                        } else {
                            return d.isCenter ? "#28a745" : "#007bff"; // Use default color otherwise
                        }
                    });
                 // Update text (shouldn't change but good practice)
                 update.select("text").text(d => d.text);
                 // Ensure text styles are applied (copied from enter)
                 update.select("text")
                     .style("fill", "#fff")
                     .style("font-size", d => d.isCenter ? "14px" : "12px");


                 // Position update is handled by the tick function via the transform attribute on the group
                 return update;
             },
            exit => exit.transition().duration(500).style("opacity", 0).remove() // Fade out and remove
        );


    // Update simulation nodes and links
    simulation.nodes(graphData.nodes);
    simulation.force("link").links(graphData.links);
    // Update collision force with potentially new nodes/radii (use radius + buffer)
    simulation.force("collide").radius(d => calculateNodeRadius(d) + 5);

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

    // Check if the concept is already in the graph and not the initial exploration
    const existingNode = graphData.nodes.find(n => n.id === lowerWord);
    if (existingNode && clickedNodeId) {
        console.log(`Concept "${lowerWord}" already explored.`);
        // Maybe highlight the node or do nothing? For now, do nothing more if clicked node is already processed.
        // If it's an existing node being clicked *again*, we might still want to re-center the view on it,
        // but the current click handler logic just re-explores, which is safe even if redundant.
        // If its image generation is pending, we don't need to trigger it again.
        if (!existingNode.isGeneratingImage && !existingNode.imageUrl) {
             // If it exists but somehow missed getting an image, trigger image gen?
             // This case should be rare with the current logic, but could add robustness.
        }
         // Still call updateGraph to ensure everything is rendered correctly
         updateGraph(); // Ensure the graph state is current
        return; // Exit if already exists and clicked
    }


    // Add loading indicator if it's the initial exploration from input box
    let loadingOverlay = null;
    if (!clickedNodeId) {
         // Remove any existing loading indicator first
        const existingLoading = container.querySelector('.loading-overlay');
        if(existingLoading) existingLoading.remove();

        loadingOverlay = document.createElement('div');
        loadingOverlay.classList.add('loading-overlay');
        loadingOverlay.textContent = `Exploring "${lowerWord}"...`;
        container.appendChild(loadingOverlay);
    }


    // If it's a new initial exploration from the input box
    if (!clickedNodeId) {
        graphData.nodes = [];
        graphData.links = [];
        // Add the initial node. D3 simulation will position it.
        // Fix center node position based on current dimensions
        updateDimensions(container); // Ensure dimensions are set before fixing center
        // Use lowercase for the center node ID and text
        graphData.nodes.push({ id: lowerWord, text: lowerWord, isCenter: true, fx: centerX, fy: centerY, imageUrl: null, isGeneratingImage: false });
         // Initialize SVG and simulation on the first explore
        initializeGraph(container);
    } else {
        // If clicking an existing node, find it and temporarily fix its position
        const exploringNode = graphData.nodes.find(n => n.id === lowerWord);
        if (exploringNode) {
            // Use current position if available, otherwise center (should have position from simulation)
            exploringNode.fx = exploringNode.x || centerX;
            exploringNode.fy = exploringNode.y || centerY;
        }
    }

    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(lowerWord); // Pass lowercase word to AI

    // Remove loading indicator after AI call (if it was created)
    if (loadingOverlay) {
        loadingOverlay.remove();
    }

     // Unfix the exploring node after getting results, unless it's the initial center
    const exploringNode = graphData.nodes.find(n => n.id === lowerWord); // Find again after potential additions
    if (exploringNode && !exploringNode.isCenter) {
        exploringNode.fx = null;
        exploringNode.fy = null;
    }


    // Add new nodes and links to graphData
    const newNodesAddedThisExploration = []; // Track nodes added in this call
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();
        const lowerConcept = cleanConcept.toLowerCase(); // Use lowercase for canonical ID

        if (!lowerConcept) return; // Skip empty lowercase concepts

        // Add node if it doesn't exist (check using lowercase ID)
        const existingNode = graphData.nodes.find(n => n.id === lowerConcept);
        let targetNode; // Store the node object (existing or new)

        if (!existingNode) {
            // Add new node. Use lowercase for id and text. Initialize image properties.
             targetNode = {
                 id: lowerConcept,
                 text: lowerConcept,
                 parentId: lowerWord,
                 imageUrl: null, // No image initially
                 isGeneratingImage: false // Not generating initially
             };
             graphData.nodes.push(targetNode);
             newNodesAddedThisExploration.push(targetNode); // Add to the list of newly added nodes
        } else {
            targetNode = existingNode;
        }

        // Add link if it doesn't exist (check using lowercase IDs)
        const linkExists = graphData.links.some(link =>
            // Check if link exists between source ID and target ID
            (link.source.id === lowerWord && link.target.id === lowerConcept) ||
            (link.source.id === lowerConcept && link.target.id === lowerWord) ||
             // Also check if link exists using string IDs if simulation hasn't resolved them yet
            (link.source === lowerWord && link.target === lowerConcept) ||
            (link.source === lowerConcept && link.target === lowerWord)
        );


        if (!linkExists) {
            // Add link using lowercase IDs
            graphData.links.push({ source: lowerWord, target: lowerConcept });
        }
    });

     // Set initial position for new nodes near their parent for smoother animation
     const parentNode = graphData.nodes.find(n => n.id === lowerWord);
     if (parentNode) {
         newNodesAddedThisExploration.forEach(newNode => {
             // If the node has no initial position set by the simulation yet,
             // position it near the parent for the start of the transition.
             // This helps nodes animate from near their parent.
             if (newNode.x === undefined) {
                 newNode.x = parentNode.x;
                 newNode.y = parentNode.y;
             }
         });
     }

    // Update the D3 graph representation immediately after adding nodes/links
    updateGraph();

    // Trigger AI image generation for newly added nodes that don't have images
    const nodesToGenerateImagesFor = newNodesAddedThisExploration.filter(node =>
        !node.imageUrl && !node.isGeneratingImage
    );

    if (nodesToGenerateImagesFor.length > 0) {
        nodesToGenerateImagesFor.forEach(async (newNode) => {
            try {
                // Mark node as generating image
                newNode.isGeneratingImage = true;
                // Update graph to show loading state (grey circle)
                updateGraph();

                // Generate image using websim.imageGen
                if (typeof websim !== 'undefined' && websim.imageGen) {
                     const prompt = `Simple visual representation of "${newNode.text}"`;
                     // Using image size based on the node radius (diameter)
                     const radius = calculateNodeRadius(newNode);
                     const imageSize = Math.ceil(radius * 2); // Ensure integer size
                     const result = await websim.imageGen({
                         prompt: prompt,
                         width: imageSize,
                         height: imageSize,
                         transparent: false // Let's start with non-transparent images
                     });

                     // Store URL and unmark generating
                     newNode.imageUrl = result.url;
                     newNode.isGeneratingImage = false;

                     // Trigger graph update to apply the new pattern fill
                     updateGraph();

                } else {
                     console.warn("websim.imageGen not available.");
                     newNode.isGeneratingImage = false; // Stop loading state
                     updateGraph(); // Revert fill from grey
                }


            } catch (error) {
                console.error(`Error generating image for "${newNode.text}":`, error);
                newNode.isGeneratingImage = false; // Stop loading state
                // Optionally set an error state or a fallback image URL on the node
                // Trigger graph update to revert from loading state (e.g., back to blue/green)
                updateGraph(); // Revert fill from grey if it was loading
            }
        });
    }
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

        // Check if modal is open before allowing keyboard controls
        const helpModal = document.getElementById('helpModal');
        if (helpModal && helpModal.classList.contains('visible')) {
             // If modal is open, only handle escape key to close it (handled elsewhere)
             return;
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