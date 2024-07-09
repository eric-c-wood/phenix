import { IPV4 } from './ipv4.js';

const SEARCH_CONST = {
	ipv4Re:/(?:\d{1,3}[.]){3}\d{1,3}(?:\/\d{1,2})?/,
	stateRe:/^(?:error|quit|running|shutdown|paused)$/,
	boolOps:/^(?:and|or|not)$/,
	groups:/(?:[(][^ ])|(?:[^ ][)])/,
	keywordEscape:/['"]([^'"]+)['"]/,
	defaultSearchFields:["Name", "Vlans", "Host", "Tags"]
}

class Stack {
  constructor() {
    this.s = [];
  }

  push(item) {
    this.s.push(item);
  }

  pop() {
    if (this.isEmpty()) {
      return null;
    }

    const lastItem = this.s[this.s.length - 1];
    this.s.pop();
    return lastItem;
  }

  isEmpty() {
    return this.s.length === 0;
  }
}

class ExpressionTree {
	constructor(term = null, searchFields = null, left = null, right = null) {
	  this.term = term;
	  this.searchFields = searchFields;
	  this.left = left;
	  this.right = right;
	}
  
	printTree() {	  
  
	  if (!this.left && !this.right) {
		return;
	  }

	  console.log(`Node:${this.term} Fields:${this.searchFields}`);  
	  
	  if (this.left) {
		this.left.printTree();
	  }
  
	  if (this.right) {
		this.right.printTree();
	  }
	}
  	
	evaluate(vm) {
		if (!this) {
			return false;
		}

		if (!this.left && !this.right) {
			return this.match(vm);
		}

		let rightSide = false;
		if (this.right) {
			rightSide = this.right.evaluate(vm);
		}

		let leftSide = false;
		if (this.left) {
			leftSide = this.left.evaluate(vm);
		}

		switch (this.term) {
		case "and":
			return rightSide && leftSide;
		case "or":
			return rightSide || leftSide;
		case "not":
			return !rightSide;
		default:
			return false;
		}
	}

	
	match(vm) {

		//console.log("matching vm: ", vm)

		for (const [key,field] of Object.entries(this.searchFields)) {
			
			switch (field) {
				case "IPv4":
					let refNet = new IPV4("")
					refNet.setAddress(this.term)
					if (refNet.address === undefined){
						continue
					}					
					
					for (const network of vm.ipv4){
						//console.log(network.trim())
						if (refNet.contains(network.trim())) {
							return true
						}
					}
					continue
				case "State":
					if (this.term == "shutdown" || this.term == "quit") {
						return vm.state.toLowerCase() == "quit"
					} else {
						return vm.state.toLowerCase() == this.term
					}					
				case "Busy":
					return vm.busy
				case "Captures":
					return vm.captures.length > 0
				case "DoNotBoot":
					return vm.dnb
				case "Vlans":						
					for (const vlan of vm.networks) {						
						if (vlan.toLowerCase().trim().includes(this.term)) {
							//console.log("Vlan: ",vlan, " : ",this.term)
							return true		
						}				
					}
					continue
				case "Name":					
					if (vm.name.toLowerCase().includes(this.term)) {
						//console.log("Name: ",vm.name)
						return true
					}
				case "Host":
					if (vm.host.toLowerCase().includes(this.term)) {
						//console.log("Host: ",vm.host)
						return true
					}
					continue
				case "Tags":					
					for (const tag of vm.tags){
						if (tag.toLowerCase().includes(this.term)) {
							//console.log("Tag: ",tag,' ',this.term)
							return true
						}
					}
						continue
				case "Disk":
					if (vm.disk.toLowerCase().includes(this.term)) {
						return true
					}
			}
		}

		return false
	}

  
}

function BuildTree(searchFilter) {
	
	searchFilter = searchFilter.trim()	
	if (searchFilter.length === 0) {
	  return null;
	}

	// Adjust any parentheses so that they are
	// space delimited	  
	if (SEARCH_CONST.groups.test(searchFilter)) {
	  searchFilter = searchFilter.replace(/\(/g, '( ');
	  searchFilter = searchFilter.replace(/\)/g, ' )');
	}

	const searchString = searchFilter.toLowerCase();
	let stringParts = searchString.split(' ');

	// If no operators were found, assume a default
	// operator of "and"	  
	let match = false;
	for (const part of stringParts) {
	  if (SEARCH_CONST.boolOps.test(part)) {
		match = true;
		break;
	  }
	}

  
  if (!match) {
	  let tmp = stringParts.join(" and ");
	  stringParts = tmp.split(" ");
  }

  let postFix;
  try {
	  postFix = postfix(stringParts);
  } catch (err) {
	  return null;
  }

  // If the only term that was passed in
  // is a boolean operator, then skip
  // building the tree
  if (postFix.length === 1) {
	  if (SEARCH_CONST.boolOps.test(postFix[0])) {
		  return null;
	  }
  }

  let expressionTree;
  try {
	  expressionTree = createTree(postFix);
  } catch (err) {
	  return null;
  }

  return expressionTree;
}


// Shunting yard algorithm by Edsger Dijkstra
// for putting search terms and operators into
// postfix notation
function postfix(terms) {
	let output = [];
	let opStack = new Stack();

	for (let term of terms) {
		if (term.length === 0) {
			continue;
		}

		if (SEARCH_CONST.boolOps.test(term) || term === '(') {
			opStack.push(term);
		} else if (term === ')') {
			let token = '';
			while (token !== '(') {
				let tmpToken = opStack.pop();
				if (typeof tmpToken !== 'string') {
					throw new Error('Error: type assertion parsing token');
				} else {
					token = tmpToken;
				}

				if (token !== '(') {
					output.push(token);
				}
			}
		} else {
			output.push(term);
		}
	}

	while (!opStack.isEmpty()) {
		let token = opStack.pop();
		if (typeof token !== 'string') {
			throw new Error('Error: type assertion parsing token');
		} else {
			output.push(token);
		}
	}

	return output;
}


function createTree(postFix) {
	let stack = new Stack();

	for (const term of postFix) {
		if (SEARCH_CONST.boolOps.test(term)) {
		let opTree = new ExpressionTree();
		opTree.term = term;

		let t1 = stack.pop();
		if (!(t1 instanceof ExpressionTree)) {
			throw new Error("Error: type assertion parsing token");
		}
		opTree.right = t1;

		if (!stack.isEmpty() && term !== "not") {
			const t2 = stack.pop();
			if (!(t2 instanceof ExpressionTree)) {
			throw new Error("Error: type assertion parsing token");
			}
			opTree.left = t2;
		}

		stack.push(opTree);
		} else {
		let operand = new ExpressionTree();
		if (SEARCH_CONST.keywordEscape.test(term)) {
			let match = SEARCH_CONST.keywordEscape.exec(term);
			operand.term = match[1];
			operand.searchFields = SEARCH_CONST.defaultSearchFields;
		} else {
			operand.term = term;
			operand.searchFields = getSearchFields(term);
		}
		stack.push(operand);
		}
	}

	const expressionTree = stack.pop();
	if (!(expressionTree instanceof ExpressionTree)) {
		throw new Error("Error: type assertion parsing token");
	}
	return expressionTree;
}
	  
	  
function getSearchFields(term) {
		
	if (SEARCH_CONST.ipv4Re.test(term)) {
		return ["IPv4"];
	} else if (SEARCH_CONST.stateRe.test(term)) {
		return ["State"];
	} else if (term.includes("capturing")) {
		return ["Captures"];
	} else if (term.includes("busy")) {
		return ["Busy"];
	} else if (term.includes("dnb")) {
		return ["DoNotBoot"];
	} else {
		return SEARCH_CONST.defaultSearchFields;
	}
}
	  
export { BuildTree }
