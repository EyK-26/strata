import React, { useEffect, useState } from "react";
import axios from "axios";

const Comments = ({ kind, id }) => {
    const [comments, setComments] = useState([]);
    const [body, setBody] = useState("");

    const load = async () => {
        const response = await axios.get(`/api/${kind}/${id}/comments`);
        setComments(response.data);
    };

    useEffect(() => {
        load();
    }, [kind, id]);

    const save = async (event) => {
        event.preventDefault();
        if (!body.trim()) {
            return;
        }
        await axios.post(`/api/${kind}/${id}/comments`, { body });
        setBody("");
        await load();
    };

    return (
        <div className="Comments">
            <h3>Comments</h3>
            {comments.map((comment) => (
                <p key={comment.id}>{comment.body}</p>
            ))}
            <form onSubmit={save}>
                <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                />
                <button type="submit">Save comment</button>
            </form>
        </div>
    );
};

export default Comments;
