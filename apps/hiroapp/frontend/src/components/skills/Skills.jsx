import React, { useEffect, useState } from "react";
import axios from "axios";

const Skills = () => {
    const [catalog, setCatalog] = useState([]);
    const [owned, setOwned] = useState([]);
    const [selected, setSelected] = useState("");

    const load = async () => {
        const [all, mine] = await Promise.all([
            axios.get("/api/skills"),
            axios.get("/api/me/skills"),
        ]);
        const available = all.data.data ?? all.data;
        const current = mine.data.data ?? mine.data;
        setCatalog(available);
        setOwned(current);
        setSelected(current.map((skill) => skill.id).join(","));
    };

    useEffect(() => {
        load();
    }, []);

    const save = async (event) => {
        event.preventDefault();
        const skills = selected
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((id) => Number.isInteger(id) && id > 0)
            .map((skill_id) => ({ skill_id, years: 1, level: "intermediate" }));
        await axios.post("/api/me/skills", { skills });
        await load();
    };

    return (
        <div className="Skills">
            <h2>Your skills</h2>
            <ul>
                {owned.map((skill) => (
                    <li key={skill.id}>{skill.name}</li>
                ))}
            </ul>
            <form onSubmit={save}>
                <label>
                    Skill ids
                    <input
                        value={selected}
                        onChange={(event) => setSelected(event.target.value)}
                    />
                </label>
                <p>
                    Available:{" "}
                    {catalog.map((skill) => `${skill.id}=${skill.name}`).join(" ")}
                </p>
                <button type="submit">Save skills</button>
            </form>
        </div>
    );
};

export default Skills;
