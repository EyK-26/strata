import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const PositionSkills = () => {
    const { id } = useParams();
    const [attached, setAttached] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [matches, setMatches] = useState([]);
    const [selected, setSelected] = useState("");

    const load = async () => {
        const [skills, all] = await Promise.all([
            axios.get(`/api/positions/${id}/skills`),
            axios.get("/api/skills"),
        ]);
        const current = skills.data.data ?? skills.data;
        setAttached(current);
        setCatalog(all.data.data ?? all.data);
        setSelected(current.map((skill) => skill.id).join(","));
    };

    useEffect(() => {
        load();
    }, [id]);

    const save = async (event) => {
        event.preventDefault();
        const skills = selected
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((skillId) => Number.isInteger(skillId) && skillId > 0)
            .map((skill_id) => ({ skill_id, required: true, weight: 1 }));
        await axios.post(`/api/positions/${id}/skills`, { skills });
        await load();
    };

    const loadMatch = async () => {
        const response = await axios.get(`/api/positions/${id}/match`);
        setMatches(response.data);
    };

    return (
        <div className="PositionSkills">
            <h2>Position skills</h2>
            <ul>
                {attached.map((skill) => (
                    <li key={skill.id}>{skill.name}</li>
                ))}
            </ul>
            <form onSubmit={save}>
                <input
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                />
                <p>
                    Available:{" "}
                    {catalog.map((skill) => `${skill.id}=${skill.name}`).join(" ")}
                </p>
                <button type="submit">Save</button>
            </form>
            <button type="button" onClick={loadMatch}>
                Show matches
            </button>
            {matches.map((row) => (
                <p key={row.user.id}>
                    {row.user.first_name} {row.user.last_name}: {row.matched} /{" "}
                    {row.required}
                </p>
            ))}
        </div>
    );
};

export default PositionSkills;
