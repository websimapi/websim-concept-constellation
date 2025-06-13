import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

// D3 variables
let svg;
let graphGroup; // Group to hold nodes and links, for zooming and panning
let linkElements; // Will now select links directly under graphGroup
let nodeElements; // Will now select nodes directly under graphGroup
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
        // Restart simulation briefly after resize to re-center nodes relative to new dimensions
        // Avoid restarting if alpha is already very low (simulation is settled)
         if (simulation.alpha() < 0.1) {
             simulation.alpha(0.1).restart(); // Gentle nudge
         } else {
             simulation.alpha(0.5).restart(); // More energetic restart if needed
         }
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
     // Ensure d.text exists before accessing length and is a string
     const text = d.text || ""; // Default to empty string if text is missing
     return Math.max(25, 15 + text.length * 3) + 5; // Added 5px buffer
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
            // Log the unexpected content for debugging
            console.log("AI Response Content:", completion.content);
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
// This function should set up the SVG, graphGroup, simulation, zoom, drag, and resize listener.
// It does NOT add the initial node(s) or links; that's handled before this is called.
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
    // Links and nodes will be appended directly to this group later in updateGraph
    graphGroup = svg.append("g");

    // Initialize force simulation
    simulation = d3.forceSimulation(graphData.nodes)
        // Increase distance for more spacing between linked nodes
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(150)) // Increased distance from 100 to 150
        .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion
        .force("center", d3.forceCenter(centerX, centerY)) // Center force (use dynamic center)
        // Add collision force to prevent node overlap
        // Using a function for radius ensures it's recalculated for each node
        .force("collide", d3.forceCollide().radius(calculateNodeRadius).iterations(2)); // Use dynamic radius function

    // Define the tick function to update positions
    simulation.on("tick", () => {
         // Check if linkElements and nodeElements are defined before updating
         if (linkElements) {
             linkElements
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
         }

         if (nodeElements) {
            // Update node group position (translate)
            nodeElements
                .attr("transform", d => `translate(${d.x},${d.y})`);
         }
    });

    // Define drag behavior
    const drag = d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);

    // Store drag function to apply to new nodes
    svg._dragBehavior = drag; // Attach to SVG for easy access

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
      // Only clear fixed position if it's not the center node
      if (!d.isCenter) {
        d.fx = null;
        d.fy = null;
      }
    }

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
         // Restart simulation briefly after resize to re-center nodes relative to new dimensions
         // Avoid restarting if alpha is already very low (simulation is settled)
          if (simulation) { // Check if simulation exists
              if (simulation.alpha() < 0.1) {
                simulation.alpha(0.1).restart(); // Gentle nudge
              } else {
                simulation.alpha(0.5).restart(); // More energetic restart if needed
              }
          }
     });
}

// Function to update D3 elements based on graphData changes
function updateGraph() {
    const container = d3.select("#visualizationArea").node(); // Get container reference
    if (!svg || !graphGroup || !simulation || !container) { // Check for all required elements
        console.error("SVG, graphGroup, simulation, or container not initialized before updating graph.");
        return;
    }

    // Ensure dimensions are up-to-date before updating graph elements
    updateDimensions(container);

    // --- Debugging: Log data and check integrity ---
    console.log("--- updateGraph started ---");
    // Deep copy for logging to avoid seeing D3's internal properties later
    // console.log("Nodes before D3 join:", JSON.parse(JSON.stringify(graphData.nodes)));
    // console.log("Links before D3 join:", JSON.parse(JSON.stringify(graphData.links)));

    // Verify links reference existing nodes
    const nodeIds = new Set(graphData.nodes.map(n => n.id));
    const invalidLinks = graphData.links.filter(link => {
         // Check both string ID and resolved object ID
        const sourceId = link.source && link.source.id !== undefined ? link.source.id : link.source;
        const targetId = link.target && link.target.id !== undefined ? link.target.id : link.target;
        const sourceExists = nodeIds.has(sourceId);
        const targetExists = nodeIds.has(targetId);
        // D3 link force requires source and target to be either valid IDs or resolved node objects
        // If the IDs in graphData.links don't exist in graphData.nodes, this is a problem.
        // Also check for undefined/null sources/targets themselves before accessing .id
        return !link.source || !link.target || !sourceExists || !targetExists;
    });

    if (invalidLinks.length > 0) {
        console.error("!!!! Found invalid links:", invalidLinks);
        console.error("!!!! Node IDs available:", Array.from(nodeIds));
        // Filter out invalid links before updating simulation
        console.warn("Filtering out invalid links from graphData.");
        graphData.links = graphData.links.filter(link => {
             const sourceId = link.source && link.source.id !== undefined ? link.source.id : link.source;
             const targetId = link.target && link.target.id !== undefined ? link.target.id : link.target;
             return nodeIds.has(sourceId) && nodeIds.has(targetId);
        });
         console.log("GraphData links after filtering:", graphData.links);
    } else {
        console.log("All links reference valid node IDs.");
    }
    console.log("--- Debugging end ---");
    // --- End Debugging ---


    // Select and join links directly under graphGroup
    // Use a key function that handles both resolved objects (with .id) and string IDs
    linkElements = graphGroup.selectAll(".relation-line")
        // Key function: use source+target IDs. Needs to handle resolved objects and strings.
        .data(graphData.links, d => {
             const sourceId = d.source && d.source.id !== undefined ? d.source.id : d.source;
             const targetId = d.target && d.target.id !== undefined ? d.target.id : d.target;
             // Use a consistent key regardless of order (e.g., "a-b" is same as "b-a")
             // This assumes links are undirected for joining purposes.
             // Ensure IDs are strings for sorting
             const id1 = String(sourceId);
             const id2 = String(targetId);
             // Handle potential null/undefined IDs in the key if not filtered, though filter should prevent this
             if (id1 === 'undefined' || id2 === 'undefined') return `invalid-link-${Math.random()}`; // Unique key for bad data
             return id1 < id2 ? id1 + "-" + id2 : id2 + "-" + id1;
        })
        .join(
            enter => enter.append("line")
                .attr("class", "relation-line")
                .attr("stroke-opacity", 0) // Start transparent for fade-in
                .lower() // Ensure lines are below nodes
                .transition().duration(500)
                .attr("stroke-opacity", 1), // Fade in
            update => update.lower(), // Ensure updated lines stay below nodes
            exit => exit.transition().duration(500).attr("stroke-opacity", 0).remove() // Fade out and remove
        );


    // Select and join nodes directly under graphGroup
    nodeElements = graphGroup.selectAll(".node")
        .data(graphData.nodes, d => d.id) // Data join with key (using lowercase ID)
        .join(
            enter => {
                 const group = enter.append("g")
                     .attr("class", d => d.isCenter ? "center-node node" : "concept-node node")
                     // Initial position for animation (optional: could be parent position)
                     // Force layout will position them afterwards. Initial position for new nodes is set before updateGraph
                     .attr("transform", d => `translate(${d.x || centerX},${d.y || centerY})`) // Use initial x,y if set, otherwise center
                     .style("opacity", 0); // Start transparent for fade-in

                 // Add circle
                 group.append("circle")
                     .attr("r", calculateNodeRadius); // Use the radius calculation function

                 // Add text
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
                     // Stop simulation briefly when clicking? Maybe not needed, let it continue.
                     // simulation.alphaTarget(0).stop();
                     // Pass the clicked node's lowercase ID for exploration
                     // Let's allow re-exploring any node. The handleExplore function will decide if AI is needed.
                     handleExplore(d.id, container, d.id); // Pass lowercase ID of clicked node
                     // Prevent event from bubbling up, potentially interfering with drag end
                     event.stopPropagation();
                 });

                 // Animate fade-in
                 group.transition().duration(500).style("opacity", 1);

                 group.raise(); // Ensure new nodes are on top

                 return group;
             },
            update => {
                // Update existing node groups
                 update.select("circle")
                     .attr("r", calculateNodeRadius); // Re-calculate radius in case text changed (unlikely here with lowercase)
                 update.select("text").text(d => d.text); // Update text (unlikely here with lowercase)
                 // No need to re-apply drag or click listeners, they are attached to the group on enter
                 update.raise(); // Ensure updated nodes stay on top
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
    // Set alpha to 1 to restart simulation with full energy
    // A full restart (alpha=1) seems appropriate after data changes.
    simulation.alpha(1).restart();
    console.log("--- updateGraph finished ---");
}

// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    const lowerWord = word.toLowerCase().trim(); // Use lowercase for canonical ID

    if (!lowerWord) {
         // This case is handled by the exploreButton listener now
        return;
    }

    // Check if this node exists in our current graph data
    const exploringNode = graphData.nodes.find(n => n.id === lowerWord);

    // Determine if we should call the AI.
    // We call AI if:
    // 1. The node doesn't exist yet (should only happen for the initial word, handled by exploreButton adding it first).
    // 2. It's a click on an existing node (clickedNodeId is not null) AND the node does NOT already have any links connected to it (meaning it hasn't been expanded yet).
    const hasExistingLinks = exploringNode ? graphData.links.some(link =>
         (link.source.id === lowerWord || link.source === lowerWord) ||
         (link.target.id === lowerWord || link.target === lowerWord)
    ) : false; // A node that doesn't exist can't have links


    // shouldCallAI is true if the node needs exploring AND it hasn't been explored before (doesn't have links)
    // Note: If exploringNode is null here, it implies an issue in the flow, as exploreButton should add it first.
    const shouldCallAI = exploringNode && clickedNodeId && !hasExistingLinks; // Only call AI on click if node exists and hasn't been expanded

    // For the *initial* explore (clickedNodeId is null), the node is added by exploreButton,
    // and we *always* call AI to get its first set of neighbors.
    const isInitialExplore = !clickedNodeId && exploringNode && !hasExistingLinks; // Check if it's the first time exploring this node

     if (!shouldCallAI && !isInitialExplore) {
         console.log(`Node "${lowerWord}" already explored or does not exist initially. Skipping AI call.`);
         // If the node exists and has been explored, and it was clicked, unfix it
         if (clickedNodeId && exploringNode && !exploringNode.isCenter) {
             exploringNode.fx = null;
             exploringNode.fy = null;
         }
         // Restart simulation if it was stopped or needed a nudge
         if (simulation && simulation.alpha() < 0.5) {
             simulation.alpha(0.5).restart();
         }
         return; // Exit the function early if AI is not needed
    }


    // Add loading indicator
    // Remove any existing loading indicator first
    const existingLoading = container.querySelector('.loading-overlay');
    if(existingLoading) existingLoading.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${lowerWord}"...`;
    container.appendChild(loadingOverlay);


    // Find the node for the word being explored (using lowercase ID) - it should exist now
    const currentExploringNode = graphData.nodes.find(n => n.id === lowerWord);
    if (!currentExploringNode) {
         console.error(`Assertion failed: Exploring node "${lowerWord}" should exist at this point.`);
         loadingOverlay.remove();
         return; // Should not happen with correct flow after fixing exploreButton logic
    }


     // Temporarily fix the position of the node being explored while generating concepts
     // Only fix if it's NOT the center node, as the center is already fixed by updateDimensions/initializeGraph
     if (!currentExploringNode.isCenter) {
        currentExploringNode.fx = currentExploringNode.x || centerX;
        currentExploringNode.fy = currentExploringNode.y || centerY;
     }


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(lowerWord); // Pass lowercase word to AI

    // Remove loading indicator after AI call
    loadingOverlay.remove();


    // Add new nodes and links to graphData
    const newNodes = [];
    let graphChanged = false; // Flag to indicate if new nodes or links were added

    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();
        const lowerConcept = cleanConcept.toLowerCase(); // Use lowercase for canonical ID

        if (!lowerConcept || lowerConcept === lowerWord) return; // Skip empty or self-referencing concepts

        // Add node if it doesn't exist (check using lowercase ID)
        const existingNode = graphData.nodes.find(n => n.id === lowerConcept);
        let targetNode; // Store the node object (existing or new)

        if (!existingNode) {
            // Add new node. Use lowercase for id and cleanConcept for display text.
             targetNode = { id: lowerConcept, text: cleanConcept };
             graphData.nodes.push(targetNode);
             newNodes.push(targetNode); // Keep track of newly added nodes
             graphChanged = true;
        } else {
            targetNode = existingNode;
            // If node exists, it's already in graphData.nodes. No need to add again.
        }

        // Add link if it doesn't exist (check using lowercase IDs for source and target)
        // Check using the ID property if it exists (resolved object), otherwise use the string
        const linkExists = graphData.links.some(link => {
            // Ensure source and target exist and have an ID or are strings
            const sourceId = link.source && link.source.id !== undefined ? link.source.id : link.source;
            const targetId = link.target && link.target.id !== undefined ? link.target.id : link.target;

            // Check both directions for the link
            return (sourceId === lowerWord && targetId === lowerConcept) ||
                   (sourceId === lowerConcept && targetId === lowerWord);
        });


        if (!linkExists) {
            // Add link using lowercase IDs (D3 force will resolve later)
            graphData.links.push({ source: lowerWord, target: lowerConcept });
             graphChanged = true;
        }
    });

     // Set initial position for new nodes near their parent for smoother animation
     // The parent node is the currentExploringNode
     if (currentExploringNode) { // Should always exist
         newNodes.forEach(newNode => {
             // If the node has no initial position set by the simulation yet,
             // position it near the parent for the start of the transition.
             // This helps nodes animate from near their parent.
             if (newNode.x === undefined) {
                 // Position new nodes slightly offset from the parent
                 // Add randomness to initial position
                 newNode.x = currentExploringNode.x + (Math.random() - 0.5) * 50;
                 newNode.y = currentExploringNode.y + (Math.random() - 0.5) * 50;
             }
         });
     } else {
         // Fallback if currentExploringNode wasn't found (shouldn't happen)
         newNodes.forEach(newNode => {
             if (newNode.x === undefined) {
                 newNode.x = centerX + (Math.random() - 0.5) * 50;
                 newNode.y = centerY + (Math.random() - 0.5) * 50;
             }
         });
     }


    // Update the D3 graph representation only if something changed
     if (graphChanged) {
         updateGraph();
     } else {
         // If no new concepts were found or added, just let simulation settle
         console.log(`No new concepts or links added for "${lowerWord}".`);
         if (simulation) { // Ensure simulation exists before restarting
            simulation.alpha(0.5).restart(); // Let simulation settle if it was disturbed (e.g., by fixing parent)
         }
     }

     // Unfix the exploring node AFTER graph update/simulation restart, unless it's the initial center
     // Use currentExploringNode which is guaranteed to exist if AI was called
     if (currentExploringNode && !currentExploringNode.isCenter) {
         currentExploringNode.fx = null;
         currentExploringNode.fy = null;
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
        const word = wordInput.value.trim();
        const lowerWord = word.toLowerCase();

        // Find the current center node if it exists
        const currentCenterNode = graphData.nodes.find(n => n.isCenter);
        const currentCenterId = currentCenterNode ? currentCenterNode.id : null;

        if (!word) {
            // If input is empty, clear the graph
             graphData.nodes = [];
             graphData.links = [];
             if (simulation) simulation.stop(); // Stop old simulation
             simulation = null; // Reset simulation
             // Clear SVG content and reset svg/graphGroup
             if (svg) svg.remove();
             svg = null;
             graphGroup = null;
             visualizationArea.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
        } else if (currentCenterId === lowerWord && graphData.nodes.length > 0) {
            // If the entered word is the same as the current center node (and graph exists),
            // simulate clicking the center node to potentially add more concepts if it hasn't been expanded fully,
            // or just let the simulation settle if it has.
            console.log(`Exploring current center word "${word}" again.`);
            // Pass lowerWord as clickedNodeId. handleExplore will decide if AI is needed.
            handleExplore(word, visualizationArea, lowerWord);
        }
        else {
            // If it's a new word or the graph is empty, start a new graph
             console.log(`Starting new exploration for "${word}".`);
             // Clear existing graph data
             graphData.nodes = [];
             graphData.links = [];
             // Stop and clear simulation if it exists
             if (simulation) simulation.stop();
             simulation = null;
             // Remove existing SVG
             if (svg) svg.remove();
             svg = null;
             graphGroup = null;

             // Add the new center node to graphData FIRST
             updateDimensions(visualizationArea); // Ensure dimensions are current before fixing center node position
             graphData.nodes.push({ id: lowerWord, text: word, isCenter: true, fx: centerX, fy: centerY });

             // Initialize D3 graph (creates SVG, simulation, etc.) using the new graphData
             initializeGraph(visualizationArea);

             // Call handleExplore for the newly added center node to fetch its related concepts
             // No clickedNodeId needed here, handleExplore logic handles initial expansion based on node existence/links
             handleExplore(word, visualizationArea);
        }
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

        // Check if a modal is open, if so, don't process keyboard events
        const helpModal = document.getElementById('helpModal');
        if (helpModal && helpModal.classList.contains('visible')) {
            return; // Do nothing if modal is open
        }

        // Check if input is focused
        if (document.activeElement === wordInput) {
            return; // Do nothing if user is typing
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