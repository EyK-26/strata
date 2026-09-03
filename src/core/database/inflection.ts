function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }

  if (/(ses|xes|zes|ches|shes)$/i.test(word)) {
    return word.slice(0, -2);
  }

  if (word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }

  return word;
}

function foreignKeyFromTable(tableName: string): string {
  return `${singularize(tableName)}_id`;
}

function pivotTableName(leftTable: string, rightTable: string): string {
  return [singularize(leftTable), singularize(rightTable)].sort().join("_");
}

export { foreignKeyFromTable, pivotTableName, singularize };
