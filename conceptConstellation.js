import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

let svg; // Declare svg globally to access it
let simulation; // Declare simulation globally
let linkGroup; // Declare link group globally
let nodeGroup; // Declare node group globally
let currentContainer; // Store the visualization container element


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


// Function to calculate radius based on text length
function getNodeRadius(text) {
    // Max of 25, or 15 + 3px per character length - adjusted for better fit
    return Math.max(20, 10 + (text ? text.length : 0) * 3);
}


// Define the tick function to update positions
function ticked() {
    if (!linkGroup || !nodeGroup || !simulation) {
        // Basic check to prevent errors if called before setup or after clear
        return;
    }

    linkGroup.selectAll("line")
        .attr("x1", d => {
            // Defensive check before accessing .x
            if (!d.source || typeof d.source.x === 'undefined') {
                 //console.error("Link source.x is undefined in tick:", d);
                return 0; // Return a default value or handle error
            }
            return d.source.x;
        })
        .attr("y1", d => {
             if (!d.source || typeof d.source.y === 'undefined') return 0;
             return d.source.y;
        })
        .attr("x2", d => {
             if (!d.target || typeof d.target.x === 'undefined') {
                 //console.error("Link target.x is undefined in tick:", d);
                 return 0; // Return a default value or handle error
             }
             return d.target.x;
        })
        .attr("y2", d => {
             if (!d.target || typeof d.target.y === 'undefined') return 0;
             return d.target.y;
        });

    nodeGroup.selectAll("g") // Select the group containing circle and text
        .attr("transform", d => {
             // Defensive check before accessing .x
             if (!d || typeof d.x === 'undefined' || typeof d.y === 'undefined') {
                  //console.error("Node position is undefined in tick:", d);
                  return "translate(0,0)";
             }
             return `translate(${d.x},${d.y})`;
        });
}

// Drag functions
function dragstarted(event) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  event.subject.fx = event.subject.x;
  event.subject.fy = event.subject.y;
}

function dragged(event) {
  event.subject.fx = event.x;
  event.subject.fy = event.y;
}

function dragended(event) {
  if (!event.active) simulation.alphaTarget(0);
  // Optional: uncomment to let forces take over after drag ends
  // event.subject.fx = null; // Release the node horizontally
  // event.subject.fy = null; // Release the node vertically
}


// Function to initialize or update the visualization using D3
function renderGraph(container) {
    currentContainer = container; // Store container reference

    // --- Handle Placeholder State ---
    if (graphData.nodes.length === 0) {
        // If simulation exists, stop it before removing elements
        if (simulation) {
            simulation.stop();
        }
        // Clear any existing SVG or content
        container.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
        // Reset D3 selections and simulation reference to indicate no graph is rendered
        svg = null;
        simulation = null;
        linkGroup = null;
        nodeGroup = null;
        return; // Stop execution here
    }

    // --- Create/Select SVG and Groups ---
    // If SVG doesn't exist (because we just moved from placeholder state or initial load)
    if (!svg) {
        container.innerHTML = ''; // Clear placeholder content
        svg = d3.select(container)
                .append("svg")
                .attr("viewBox", "0 0 800 500"); // Match container size

        // Create groups for links and nodes
        linkGroup = svg.append("g").attr("class", "links");
        nodeGroup = svg.append("g").attr("class", "nodes");
    }


    // --- Initialize or RE-INITIALIZE the force simulation ---
    // Stop any existing simulation first
    if (simulation) {
        simulation.stop();
    }

    // Re-initialize the force simulation with the CURRENT graphData
    // D3 forces modify node/link objects *in place* in the arrays provided to simulation.nodes() and force.links()
    simulation = d3.forceSimulation(graphData.nodes)
        // Link force with reduced distance
        .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(80))
        // Node repulsion force (slightly increased)
        .force("charge", d3.forceManyBody().strength(-500))
        // Center force (center of 800x500 viewbox)
        .force("center", d3.forceCenter(400, 250))
        // Add collision force to prevent overlaps based on node radius + padding
        .force("collide", d3.forceCollide().radius(d => getNodeRadius(d.text) + 5))
        // Attach tick handler
        .on("tick", ticked);

    // --- D3 Data Binding and Update ---
    // Use the existing linkGroup and nodeGroup selections

    // Update links using join
    // Key function needs to handle source/target being objects (after D3's resolution) or strings (initially)
    const links = linkGroup.selectAll("line")
        .data(graphData.links, d => {
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            return [sourceId, targetId].sort().join("-"); // Use sorted IDs as key
        });

    links.join(
        enter => enter.append("line")
            .attr("class", "relation-line"), // Add class for styling
        update => update, // No specific updates needed for existing lines currently
        exit => exit.remove() // Remove old links that are no longer in data
    );


    // Update nodes (using groups for circle+text) using join
    const nodes = nodeGroup.selectAll("g") // Select the group containing circle and text
        .data(graphData.nodes, d => d.id); // Use node id as key

    nodes.join(
        enter => {
            // Create new group for each entering node
            const newNodeGroup = enter.append("g")
                .attr("class", d => d.isCenter ? "center-node" : "concept-node")
                // Apply drag behavior to *all* entering nodes and update nodes
                // D3's drag behavior is often applied on the 'update' selection + 'enter' selection or just 'nodes.call(drag)'
                // Applying it only on 'enter' ensures it's attached only once per element
                .call(d3.drag()
                    .on("start", dragstarted)
                    .on("drag", dragged)
                    .on("end", dragended))
                .on("click", (event, d) => { // Add click listener for exploration
                     // Prevent immediate exploration if just finished dragging (D3 sets event.defaultPrevented)
                     if (event.defaultPrevented) return;
                     // Explore the clicked node's relations using its ID
                     handleExplore(d.id, currentContainer, d.id);
                });

            // Append circle and text to the new group
            newNodeGroup.append("circle")
                 .attr("r", d => getNodeRadius(d.text)); // Set radius based on text

            newNodeGroup.append("text")
                 .attr("dy", "0.35em") // Vertical alignment
                 .attr("text-anchor", "middle") // Horizontal alignment
                 .style("pointer-events", "none") // Ensure text doesn't block clicks on the circle
                 .style("user-select", "none") // Prevent text selection
                 .text(d => d.text); // Set text content

            return newNodeGroup; // Return the new group selection
        },
        update => {
             // Update attributes for existing nodes if needed (e.g., radius, text)
             update.select("circle").attr("r", d => getNodeRadius(d.text));
             update.select("text").text(d => d.text); // Update text if node data changed
             // Drag behavior is persistent, doesn't need reapplying on 'update'
             return update; // Return the update selection
        },
        exit => exit.remove() // Remove old nodes that are no longer in data
    );

    // Restart the simulation
    simulation.alpha(1).restart(); // Set high alpha for strong restart

    // Manually run simulation tick once to position new elements immediately
    simulation.tick();
}


// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    const lowerWord = word.toLowerCase().trim();

    if (!lowerWord) {
        if (!clickedNodeId) { // Only clear and show placeholder if initiating from an empty input
             graphData.nodes = [];
             graphData.links = [];
             renderGraph(container); // Re-render to clear the SVG and show placeholder
        }
        return;
    }

    // Determine if this is a completely new exploration from the input box
    const isInitialInputExplore = !clickedNodeId;
    const sourceNodeId = lowerWord; // The ID of the node being explored/clicked

    if (isInitialInputExplore) {
        // If starting fresh from input, clear previous graph data completely
        graphData.nodes = [];
        graphData.links = [];
        // Add the new central node. This is the *only* node marked as the initial center.
        graphData.nodes.push({ id: sourceNodeId, text: sourceNodeId, isCenter: true });
    } else {
         // If clicking an existing node, ensure it exists in our data array
         // This check is mostly defensive; the node must exist to be clicked.
         const sourceNodeExists = graphData.nodes.some(n => n.id === sourceNodeId);
         if (!sourceNodeExists) {
             console.warn(`Clicked node "${sourceNodeId}" not found in graphData.nodes, attempting to add.`);
             // Add the clicked node if somehow missing (shouldn't happen)
             graphData.nodes.push({ id: sourceNodeId, text: sourceNodeId, isCenter: false });
         }
         // Note: When clicking a node, we add its related concepts and links to the existing graph.
    }


    // Add loading indicator
    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${lowerWord}"...`;
    // Assume visualizationArea is the container for the overlay
    const overlayContainer = container;
    // Ensure position is relative for absolute overlay positioning (already done in CSS, but defensive)
     overlayContainer.style.position = 'relative';


    // Check if a loading overlay already exists and update its text, or append a new one
     const existingLoadingOverlay = overlayContainer.querySelector('.loading-overlay');
     if (!existingLoadingOverlay) {
        overlayContainer.appendChild(loadingOverlay);
     } else {
        existingLoadingOverlay.textContent = loadingOverlay.textContent; // Update text if exists
     }


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(sourceNodeId);

    // Remove loading indicator after AI call
    const currentLoadingOverlay = overlayContainer.querySelector('.loading-overlay');
    if (currentLoadingOverlay) {
         currentLoadingOverlay.remove();
    }

    // Add new nodes and links to graphData based on related concepts
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();

        if (!cleanConcept || cleanConcept.toLowerCase() === sourceNodeId) {
             // Skip empty strings or the original word itself (already filtered in generateRelatedConcepts, but double-check)
            return;
        }

        // --- Logic to ensure unique nodes and links ---

        // 1. Find or add the target node (the related concept)
        let targetNode = graphData.nodes.find(n => n.id === cleanConcept);
        if (!targetNode) {
            // If node doesn't exist, add it to the graph data
            targetNode = { id: cleanConcept, text: cleanConcept, isCenter: false };
            graphData.nodes.push(targetNode);
            // Note: The new node is added to the array, D3 will handle rendering it.
        }
        // Else: The node already exists, we will link to the existing node.

        // 2. Add a link between the source node (the one being explored, `sourceNodeId`) and the target node (`cleanConcept`)
        // Check if a link already exists between sourceNodeId and cleanConcept (in either direction)
        const linkExists = graphData.links.some(link => {
             // Need to handle source/target being objects or strings here for the check
             const linkSourceId = typeof link.source === 'object' ? link.source.id : link.source;
             const linkTargetId = typeof link.target === 'object' ? link.target.id : link.target;
             const ids1 = [linkSourceId, linkTargetId].sort().join("-");
             const ids2 = [sourceNodeId, cleanConcept].sort().join("-"); // Use sourceNodeId here
             return ids1 === ids2;
        });


        if (!linkExists) {
             // If link doesn't exist, add it to the graph data
             // Add link using node IDs; D3's forceLink.id() will resolve them to node objects
            graphData.links.push({ source: sourceNodeId, target: cleanConcept });
             // Note: The new link is added to the array, D3 will handle rendering it.
        }
        // Else: The link already exists, do nothing.
    });

    // Log data before rendering to help debug if needed
    // console.log("Graph Data Before Render:", {
    //     nodesCount: graphData.nodes.length,
    //     linksCount: graphData.links.length,
    //     nodes: JSON.parse(JSON.stringify(graphData.nodes)), // Deep copy for logging state
    //     links: JSON.parse(JSON.stringify(graphData.links))
    // });


    // Render the updated graph with the newly added nodes and links
    // D3's join method will automatically create elements for new data,
    // update existing elements, and remove elements no longer in the data.
    renderGraph(container);
}


// Setup function called from script.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        // Initial exploration from input box, clickedNodeId is null
        handleExplore(word, visualizationArea);
    });

    // Optional: Allow pressing Enter in the input field
    wordInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission
            exploreButton.click();
        }
    });

    // Initial state: render the placeholder graphic
    renderGraph(visualizationArea);
}