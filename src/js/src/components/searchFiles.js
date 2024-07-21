const FILE_SEARCH_CONST = {
	  dateRe:/[<>=]{1,2}[ ]?\d{4}[-]\d{2}(?:[\d-]+(?:[ ][\d:z]+)?)?/g,
    sizeRe:/[<>=]{1,2}[ ]?\d+(?:[ ]?(?:b|kb|mb|gb))?/g,
    categoryRe:/^(?:packet|elf|vm)/g,
    comparisonOps:/[<>=]{1,2}/,
    fileSizeSpec:/(?:b|kb|mb|gb)/,
    boolOps:/^(?:and|or|not)$/,
    groups:/(?:[(][^ ])|(?:[^ ][)])/,
    keywordEscape:/['"]([^'"]+)['"]/,
    defaultSearchFields:["Name", "Category"],
    spaceReplacement:"-sp-32-sp-"
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
  	
	evaluate(experimentFile) {
		if (!this) {
			return false;
		}

		if (!this.left && !this.right) {
			return this.match(experimentFile);
		}

		let rightSide = false;
		if (this.right) {
			rightSide = this.right.evaluate(experimentFile);
		}

		let leftSide = false;
		if (this.left) {
			leftSide = this.left.evaluate(experimentFile);
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

	
	match(file) {		    

    let compOp, newTerm, layout,fileSize;

		for (const [key,field] of Object.entries(this.searchFields)) {
			
			switch (field) {
				case "Date":                    

                    // Try to determine the date format
                    const numHyphens = this.term.split("-").length - 1;
                    switch (numHyphens) {
                        case 1:
                            layout = "2006-01";
                            break;
                        case 2:
                            const numColons = this.term.split(":").length - 1;
                            switch (numColons) {
                                case 0:
                                    layout = "2006-01-02";
                                    if (this.term.includes("_")) {
                                        layout = "2006-01-02_15";
                                    }
                                    break;
                                case 1:
                                    layout = "2006-01-02_15:04";
                                    break;
                                case 2:
                                    layout = "2006-01-02_15:04:05";
                                    break;
                            }
                            break;
                    }

                    
                    if (FILE_SEARCH_CONST.comparisonOps.test(this.term)) {
                        compOp = FILE_SEARCH_CONST.comparisonOps.exec(this.term)[0];                      
                        newTerm = this.term.replace(FILE_SEARCH_CONST.comparisonOps, "");      
                        newTerm = newTerm.replace("_"," "); 
                    }               

                    // Make sure a valid comparison operator was found
                    if (compOp.length === 0) {
                        return false;
                    }
                   
                    let t;
                    try {
                     t = new Date(newTerm);
                    } catch (e) {
                     return false;
                    }                    

                    let fileDateTime;
                    try {
                     fileDateTime = new Date(file.date);
                    } catch (e) {
                     return false;
                    }                                        

                    switch (compOp) {
                        case "<":
                            return fileDateTime < t;
                        case ">":
                            return fileDateTime > t;
                        case "=":
                            return dateTimeEqual(fileDateTime, t,layout);
                        case ">=":
                            return fileDateTime >= t || dateTimeEqual(fileDateTime, t,layout);
                        case "<=":
                            return fileDateTime <= t || dateTimeEqual(fileDateTime, t,layout);
                    }

                case "Size":
                    
                    if (FILE_SEARCH_CONST.comparisonOps.test(this.term)) {
                        compOp = FILE_SEARCH_CONST.comparisonOps.exec(this.term)[0];
                        newTerm = this.term.replace(FILE_SEARCH_CONST.comparisonOps,"");
                    }

                    // Make sure a valid comparison operator was found
                    if (compOp.length === 0) {
                        return false;
                    }

                    if (FILE_SEARCH_CONST.fileSizeSpec.test(this.term)) {
                        let spec = FILE_SEARCH_CONST.fileSizeSpec.exec(newTerm)[0];
                        newTerm = newTerm.replace(FILE_SEARCH_CONST.fileSizeSpec,"");

                        fileSize = parseInt(newTerm, 10);
                        if (isNaN(fileSize)) {
                            return false;
                        }

                        switch (spec) {
                            case "kb":
                                fileSize *= Math.pow(10, 3);
                                break;
                            case "mb":
                                fileSize *= Math.pow(10, 6);
                                break;
                            case "gb":
                                fileSize *= Math.pow(10, 9);
                                break;
                        }
                    }

                    // Check if fileSize has already been converted to a number
                    if (typeof fileSize !== "number") {
                        fileSize = parseInt(newTerm, 10);
                        if (isNaN(fileSize)) {
                            return false;
                        }
                    }                   

                    switch (compOp) {
                        case "<":
                            return file.size < fileSize;
                        case ">":
                            return file.size > fileSize;
                        case "=":
                            return file.size === fileSize;
                        case ">=":
                            return file.size >= fileSize;
                        case "<=":
                            return file.size <= fileSize;
                    }

					
				case "Name":					
					if (file.name.toLowerCase().includes(this.term)) {
						
						return true
					}		
                    
                    continue
			}
		}

		return false
	}

  
}

function BuildFileSearchTree(searchFilter) {	
  searchFilter = searchFilter.trim()
  
	if (searchFilter.length === 0) {
	  return null;
	}

	// Adjust any parentheses so that they are
	// space delimited	  
	if (FILE_SEARCH_CONST.groups.test(searchFilter)) {
	  searchFilter = searchFilter.replaceAll('(', '( ');
	  searchFilter = searchFilter.replaceAll(')', ' )');
	}

	let searchString = searchFilter.toLowerCase();

    // Add any placeholder spaces

    // The date string will be a special case as we
    // replace the 1st space and the 2nd space with
    // different placeholders
    if (searchString.search(FILE_SEARCH_CONST.dateRe) != -1) {
        const matches = searchString.match(FILE_SEARCH_CONST.dateRe);  

        for (const match of matches) {
          let replacement;
          if (match.split(" ").length > 1) {
              replacement = match.replace(" ", FILE_SEARCH_CONST.spaceReplacement, 1);
              replacement = replacement.replaceAll(" ", "_");
          } else if (match.split(" ").length === 1 && match.split("-").length === 3) {
              replacement = match.replaceAll(" ", "_");
          } else {
              replacement = match.replace(" ", FILE_SEARCH_CONST.spaceReplacement, 1);
          }   
      
          // Update search string with replacements 
          searchString = searchString.replaceAll(match, replacement);
        }
    }
    
    searchString = addPlaceholderSpaces(searchString, FILE_SEARCH_CONST.sizeRe);
    searchString = addPlaceholderSpaces(searchString, FILE_SEARCH_CONST.categoryRe);


	let stringParts = searchString.split(' ');

	// If no operators were found, assume a default
	// operator of "and"	  
	let match = false;
	for (const part of stringParts) {
	  if (FILE_SEARCH_CONST.boolOps.test(part)) {
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
	  if (FILE_SEARCH_CONST.boolOps.test(postFix[0])) {
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

		if (FILE_SEARCH_CONST.boolOps.test(term) || term === '(') {
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
		if (FILE_SEARCH_CONST.boolOps.test(term)) {
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
            if (FILE_SEARCH_CONST.keywordEscape.test(term)) {
                let match = FILE_SEARCH_CONST.keywordEscape.exec(term)[0];
                operand.term = match[1];
                operand.searchFields = FILE_SEARCH_CONST.defaultSearchFields;
            } else {
                operand.term = term;

                // Replace any space placeholders to return
				        // the correct search fields
                operand.term = operand.term.replaceAll(FILE_SEARCH_CONST.spaceReplacement,"");

                operand.searchFields = getSearchFields(operand.term);
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
 		
	if (term.search(FILE_SEARCH_CONST.dateRe) != -1) {
		return ["Date"];
	} else if (term.search(FILE_SEARCH_CONST.sizeRe) != -1) {
		return ["Size"];
	} else if (term.search(FILE_SEARCH_CONST.categoryRe) != -1) {
		return ["Category"];	
	} else {
		return FILE_SEARCH_CONST.defaultSearchFields;
	}
}

function dateTimeEqual(t, t1, layout) {
    switch (layout) {
      case "2006-01":
        return t.getFullYear() === t1.getFullYear() && t.getMonth() === t1.getMonth();
      case "2006-01-02":
        return t.getFullYear() === t1.getFullYear() && t.getMonth() === t1.getMonth() && t.getDate() === t1.getDate();
      case "2006-01-02_15":
        const yearMonthDay = t.getFullYear() === t1.getFullYear() && t.getMonth() === t1.getMonth() && t.getDate() === t1.getDate();
        return yearMonthDay && t.getHours() === t1.getHours();
      case "2006-01-02_15:04":
        const yearMonthDay2 = t.getFullYear() === t1.getFullYear() && t.getMonth() === t1.getMonth() && t.getDate() === t1.getDate();
        return yearMonthDay2 && t.getHours() === t1.getHours() && t.getMinutes() === t1.getMinutes();
      case "2006-01-02_15:04:05":
        const yearMonthDay3 = t.getFullYear() === t1.getFullYear() && t.getMonth() === t1.getMonth() && t.getDate() === t1.getDate();
        return yearMonthDay3 && t.getHours() === t1.getHours() && t.getMinutes() === t1.getMinutes() && t.getSeconds() === t1.getSeconds();
      default:
        return false;
    }
  }
  
function addPlaceholderSpaces(searchString, pattern) {

  // Replace spaces with the replacement string
  if (searchString.search(pattern) != -1) {
    const extracted = searchString.match(pattern);
    for (const match of extracted) {
      const replacement = match.replaceAll(" ", FILE_SEARCH_CONST.spaceReplacement);
      searchString = searchString.replaceAll(match, replacement);
    }   
  }
 
  
  return searchString;
}
  
  
	  
export { BuildFileSearchTree }
