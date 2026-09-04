import React, { useState } from "react";

const SearchBar = ({ setSearch, subject }) => {
    const [input, setInput] = useState("");

    const handleSearch = (event) => {
        setInput(event.target.value);
    };

    const submitSearch = (event) => {
        event.preventDefault();
        setSearch(input);
    };

    return (
        <form onSubmit={submitSearch} className="searchbar">
            <input
                type="text"
                placeholder={"Search for " + subject + "...."}
                onInput={handleSearch}
                value={input}
            />
            <div className="search-button">
                <button type="submit"> Search </button>
            </div>
        </form>
    );
};

export default SearchBar;
