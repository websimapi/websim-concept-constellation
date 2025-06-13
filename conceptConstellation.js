import * as d3 from "d3";

// Global graph data structure
let graphData = {
    nodes: [],
    links: []
};

let svg; // Declare svg globally to access it in update function
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


// Function to initialize or update the visualization using D3
function renderGraph(container) {
    currentContainer = container; // Store container reference

    // If SVG doesn't exist, create it
    if (!svg) {
        container.innerHTML = ''; // Clear initial placeholder
        svg = d3.select(container)
                .append("svg")
                .attr("viewBox", "0 0 800 500"); // Match container size
                // Create groups for links and nodes to control drawing order
        linkGroup = svg.append("g").attr("class", "links");
        nodeGroup = svg.append("g").attr("class", "nodes");

        // Initialize the force simulation
        simulation = d3.forceSimulation(graphData.nodes)
            .force("link", d3.forceLink(graphData.links).id(d => d.id).distance(100)) // Link force with specified distance
            .force("charge", d3.forceManyBody().strength(-300)) // Node repulsion force
            .force("center", d3.forceCenter(400, 250)); // Center force

        // Add drag behavior
        const drag = d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);

        // Apply drag behavior later when nodes are created/updated

        // Define the tick function to update positions
        simulation.on("tick", () => {
            linkGroup.selectAll("line")
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            nodeGroup.selectAll("g") // Select the group containing circle and text
                .attr("transform", d => `translate(${d.x},${d.y})`);
        });

         // Initial state: display placeholder if no nodes
         if (graphData.nodes.length === 0) {
              container.innerHTML = '<p class="placeholder">Enter a word above and click \'Explore\' to see the concept constellation.</p>';
              svg = null; // Reset svg so it's recreated next time
              simulation = null; // Reset simulation
              linkGroup = null;
              nodeGroup = null;
              currentContainer = null;
              return;
         }

    } else {
        // Update simulation with new data if SVG already exists
         simulation.nodes(graphData.nodes);
         simulation.force("link").links(graphData.links);
         simulation.alpha(1).restart(); // Restart simulation
    }


    // --- D3 Data Binding and Update ---

    // Update links
    const links = linkGroup.selectAll("line")
        .data(graphData.links, d => d.source.id + "-" + d.target.id); // Use a key function for efficient updates

    // Exit old links
    links.exit().remove();

    // Enter new links
    links.enter().append("line")
        .attr("class", "relation-line"); // Add class for styling

    // Update nodes (using groups for circle+text)
    const nodes = nodeGroup.selectAll("g")
        .data(graphData.nodes, d => d.id); // Use node id as key

    // Exit old nodes
    nodes.exit().remove();

    // Enter new nodes (create the group, circle, and text)
    const newNodeGroups = nodes.enter().append("g")
        .attr("class", d => d.isCenter ? "center-node" : "concept-node")
        .call(d3.drag() // Apply drag behavior
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended))
        .on("click", (event, d) => { // Add click listener for exploration
             // Prevent immediate exploration if just finished dragging
             if (event.defaultPrevented) return;
             handleExplore(d.id, currentContainer, d.id); // Explore the clicked node
        });

    newNodeGroups.append("circle")
         .attr("r", d => getNodeRadius(d.text)); // Set radius based on text

    newNodeGroups.append("text")
         .attr("dy", "0.35em") // Vertical alignment
         .attr("text-anchor", "middle") // Horizontal alignment
         .style("pointer-events", "none") // Ensure text doesn't block clicks
         .style("user-select", "none") // Prevent text selection
         .text(d => d.text); // Set text content


    // --- Drag functions ---
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
      // Optional: Fix the node in place after drag ends, or let the forces take over
      // event.subject.fx = null;
      // event.subject.fy = null;
    }

}


// Main function to handle exploration or node click
async function handleExplore(word, container, clickedNodeId = null) {
    if (!word || word.trim() === "") {
        if (!clickedNodeId) { // Only clear and show placeholder if not clicking on a node
             graphData.nodes = [];
             graphData.links = [];
             // Re-render to clear the SVG and show placeholder
             renderGraph(container);
        }
        return;
    }

    // Check if this word is already the center node
    const isInitialCenter = graphData.nodes.length > 0 && graphData.nodes[0].id === word && graphData.nodes[0].isCenter;

    // If it's a new initial exploration from the input box, or clicking on a non-center node
    // We need to add the main node if it's not already in the graph, or if we are clearing/restarting
    if (!clickedNodeId || !graphData.nodes.some(n => n.id === word)) {
         // If starting fresh from input, clear previous data
         if (!clickedNodeId) {
              graphData.nodes = [];
              graphData.links = [];
              // Add the initial node.
              graphData.nodes.push({ id: word, text: word, isCenter: true });
         } else {
             // If clicking an existing node that somehow wasn't added correctly initially, add it now.
             // This case should ideally not happen with the current logic, but as a safeguard.
             if (!graphData.nodes.find(n => n.id === word)) {
                 graphData.nodes.push({ id: word, text: word, isCenter: clickedNodeId === word && graphData.nodes.length === 0 });
             }
         }
    }


    // Add loading indicator
    // Remove any existing loading indicator first
    const existingLoading = container.querySelector('.loading-overlay');
    if(existingLoading) existingLoading.remove();

    const loadingOverlay = document.createElement('div');
    loadingOverlay.classList.add('loading-overlay');
    loadingOverlay.textContent = `Exploring "${word}"...`;
    container.appendChild(loadingOverlay);


    // Call AI to get related concepts
    const relatedConcepts = await generateRelatedConcepts(word);

    // Remove loading indicator after AI call
    loadingOverlay.remove();


    // Add new nodes and links to graphData
    relatedConcepts.forEach(concept => {
        const cleanConcept = concept.trim();

        if (!cleanConcept) return;

        // Add node if it doesn't exist
        const existingNode = graphData.nodes.find(n => n.id === cleanConcept);
        if (!existingNode) {
            // Add new node. D3 simulation will position it.
             graphData.nodes.push({ id: cleanConcept, text: cleanConcept, isCenter: false }); // New nodes are not centers
        }

        // Add link if it doesn't exist (check both directions)
        const linkExists = graphData.links.some(link =>
            (link.source.id === word && link.target.id === cleanConcept) ||
            (link.source.id === cleanConcept && link.target.id === word)
        );

        if (!linkExists) {
             // D3 link force requires source/target to be node objects or their IDs.
             // We add them as objects here, but D3 forceLink can resolve IDs too if .id() is set.
             // Adding as IDs initially and let D3 resolve them via forceLink.id()
            graphData.links.push({ source: word, target: cleanConcept });
        }
    });

    // Render the updated graph
    renderGraph(container);
}


// Setup function called from index.js
export function setupConceptConstellation(wordInput, exploreButton, visualizationArea) {
    // Add event listener to the button
    exploreButton.addEventListener('click', () => {
        const word = wordInput.value;
        handleExplore(word, visualizationArea); // Initial explore, no clickedNodeId
    });

    // Optional: Allow pressing Enter in the input field
    wordInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission
            exploreButton.click();
        }
    });

    // Initial state: render the placeholder
    renderGraph(visualizationArea);
}